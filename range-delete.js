// "메시지 범위 삭제" in the Options menu. Works like ST's own "Delete messages": check boxes on
// the messages and the Delete / Cancel bar in place of the input. Tap the first and the last
// message of a range; only the messages between them are picked (ST's own takes everything
// below the picked message). ST's own bar is reused, so it looks the way the theme draws it.
import { MODULE, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_range_delete';
const MODE_CLASS = 'stqa_range_mode';
// ST's own mark for messages picked to be deleted
const PICKED_CLASS = 'selected';

let active = false;
let first = null;
let range = null;
let formDisplay = '';

function messageIdOf(element) {
    const id = Number(element?.closest('#chat .mes')?.getAttribute('mesid'));
    return Number.isInteger(id) ? id : null;
}

function mark(from, to) {
    for (const element of document.querySelectorAll('#chat .mes')) {
        const id = messageIdOf(element);
        const picked = id !== null && id >= from && id <= to;
        element.classList.toggle(PICKED_CLASS, picked);
        const box = element.querySelector(':scope > .del_checkbox');
        if (box) {
            box.checked = picked;
        }
    }
}

function stop() {
    if (!active) {
        return;
    }
    active = false;
    first = range = null;
    mark(-1, -1);
    document.body.classList.remove(MODE_CLASS);
    document.getElementById('dialogue_del_mes')?.style.setProperty('display', 'none');
    const form = document.getElementById('send_form');
    if (form) {
        form.style.display = formDisplay;
    }
    document.removeEventListener('click', onClick, true);
}

async function remove() {
    const picked = range;
    stop();
    if (picked) {
        await SillyTavern.getContext().executeSlashCommandsWithOptions(`/cut ${picked[0]}-${picked[1]}`);
    }
}

/** While picking, taps on messages and on the bar's buttons are ours, not ST's. */
function onClick(event) {
    if (event.target.closest('#dialogue_del_mes_ok')) {
        event.preventDefault();
        event.stopPropagation();
        remove().catch(error => console.error(`[${MODULE}] Range delete failed`, error));
        return;
    }
    if (event.target.closest('#dialogue_del_mes_cancel')) {
        event.preventDefault();
        event.stopPropagation();
        stop();
        return;
    }
    const id = messageIdOf(event.target);
    if (id === null) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    // First tap: the start; second tap: the end; a tap after that starts over
    if (first === null) {
        first = id;
        range = [id, id];
    } else {
        range = [Math.min(first, id), Math.max(first, id)];
        first = null;
    }
    mark(...range);
}

function start() {
    if (!SillyTavern.getContext().chat.length) {
        toastr.info('메시지가 없습니다.', '편의성 모음');
        return;
    }
    // ST's own delete mode open: close it first
    if (document.getElementById('dialogue_del_mes')?.style.display === 'block') {
        document.getElementById('dialogue_del_mes_cancel')?.click();
    }
    const form = document.getElementById('send_form');
    const bar = document.getElementById('dialogue_del_mes');
    if (!form || !bar) {
        return;
    }
    active = true;
    first = range = null;
    formDisplay = form.style.display;
    form.style.display = 'none';
    bar.style.display = 'block';
    document.body.classList.add(MODE_CLASS);
    // Added after the menu's own click, so the tap that opened this doesn't pick a message
    setTimeout(() => active && document.addEventListener('click', onClick, true));
}

export function applyRangeDelete() {
    const item = document.getElementById(OPTION_ID);
    if (item) {
        item.hidden = !isOn('rangeDelete');
    }
    if (!isOn('rangeDelete')) {
        stop();
    }
}

export function initRangeDelete() {
    const menu = document.querySelector('#options .options-content');
    if (!menu) {
        return;
    }
    const item = document.createElement('a');
    item.id = OPTION_ID;
    item.innerHTML = '<i class="fa-lg fa-solid fa-eraser"></i><span>메시지 범위 삭제</span>';
    item.addEventListener('click', () => {
        // Close the Options menu the way its own button does, so it is out of the way
        if (document.getElementById('options')?.style.display !== 'none') {
            document.getElementById('options_button')?.click();
        }
        Promise.resolve(start()).catch(error => console.error(`[${MODULE}] Range delete failed`, error));
    });
    // Next to ST's own "Delete messages"
    const own = document.getElementById('option_delete_mes');
    own ? own.after(item) : menu.append(item);
    applyRangeDelete();
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, stop);
}
