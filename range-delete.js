// "메시지 범위 삭제" and "메시지 범위 숨기기" in the Options menu. Works like ST's own "Delete
// messages": check boxes on the messages and the Delete / Cancel bar in place of the input. Tap
// the first and the last message of a range; only the messages between them are picked (ST's own
// takes everything below the picked message). ST's own bar is reused, so it looks the way the
// theme draws it; for hiding, its button says 숨기기 while picking.
import { MODULE, isOn } from './settings.js';

const MODE_CLASS = 'stqa_range_mode';
// ST's own mark for messages picked to be deleted
const PICKED_CLASS = 'selected';
const TITLE = '편의성 모음';

const MODES = Object.freeze({
    delete: { setting: 'rangeDelete', option: 'stqa_option_range_delete', icon: 'fa-eraser', label: '메시지 범위 삭제', command: 'cut' },
    hide: { setting: 'rangeHide', option: 'stqa_option_range_hide', icon: 'fa-eye-slash', label: '메시지 범위 숨기기', command: 'hide', button: '숨기기' },
});

let active = null;
let first = null;
let range = null;
let formDisplay = '';
// The bar button's own label, put back after hiding
let okLabel = null;

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
    active = null;
    first = range = null;
    mark(-1, -1);
    document.body.classList.remove(MODE_CLASS);
    document.getElementById('dialogue_del_mes')?.style.setProperty('display', 'none');
    const ok = document.getElementById('dialogue_del_mes_ok');
    if (ok && okLabel !== null) {
        ok.innerHTML = okLabel;
    }
    okLabel = null;
    const form = document.getElementById('send_form');
    if (form) {
        form.style.display = formDisplay;
    }
    document.removeEventListener('click', onClick, true);
}

async function apply() {
    const picked = range;
    const { command } = MODES[active];
    stop();
    if (picked) {
        await SillyTavern.getContext().executeSlashCommandsWithOptions(`/${command} ${picked[0]}-${picked[1]}`);
    }
}

/** While picking, taps on messages and on the bar's buttons are ours, not ST's. */
function onClick(event) {
    if (event.target.closest('#dialogue_del_mes_ok')) {
        event.preventDefault();
        event.stopPropagation();
        apply().catch(error => console.error(`[${MODULE}] Range ${active} failed`, error));
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

function start(mode) {
    if (!SillyTavern.getContext().chat.length) {
        toastr.info('메시지가 없습니다.', TITLE);
        return;
    }
    stop();
    // ST's own delete mode open: close it first
    if (document.getElementById('dialogue_del_mes')?.style.display === 'block') {
        document.getElementById('dialogue_del_mes_cancel')?.click();
    }
    const form = document.getElementById('send_form');
    const bar = document.getElementById('dialogue_del_mes');
    if (!form || !bar) {
        return;
    }
    active = mode;
    first = range = null;
    formDisplay = form.style.display;
    form.style.display = 'none';
    bar.style.display = 'block';
    const ok = document.getElementById('dialogue_del_mes_ok');
    if (ok && MODES[mode].button) {
        okLabel = ok.innerHTML;
        ok.textContent = MODES[mode].button;
    }
    document.body.classList.add(MODE_CLASS);
    // Added after the menu's own click, so the tap that opened this doesn't pick a message
    setTimeout(() => active && document.addEventListener('click', onClick, true));
}

/**
 * Hides a range typed as numbers ("3-10", or one number), for the shortcut button.
 * Hidden messages stay in the chat (ST leaves them out of the prompt); the eye on a message shows it again.
 */
export async function askAndHideRange() {
    const context = SillyTavern.getContext();
    const last = context.chat.length - 1;
    if (last < 0) {
        toastr.info('메시지가 없습니다.', TITLE);
        return;
    }
    const answer = await context.Popup.show.input('메시지 범위 숨기기', `숨길 메시지 번호를 적습니다. 예: 3-10 (하나만이면 5)<br>0 ~ ${last}`, '', { okButton: '숨기기', cancelButton: '취소' });
    if (answer === null || answer === false || String(answer).trim() === '') {
        return;
    }
    const numbers = String(answer).replace(/#/g, '').split(/\s*[-~]\s*/).map(part => Number(part.trim()));
    const [from, to = from] = numbers;
    if (numbers.length > 2 || ![from, to].every(number => Number.isInteger(number) && number >= 0 && number <= last)) {
        await context.Popup.show.text('없는 번호', `0 ~ ${last} 사이 번호로 적어 주세요. 예: 3-10`);
        return;
    }
    await context.executeSlashCommandsWithOptions(`/hide ${Math.min(from, to)}-${Math.max(from, to)}`);
}

export function applyRangeDelete() {
    for (const [mode, { setting, option }] of Object.entries(MODES)) {
        const item = document.getElementById(option);
        if (item) {
            item.hidden = !isOn(setting);
        }
        if (active === mode && !isOn(setting)) {
            stop();
        }
    }
}

export function initRangeDelete() {
    const menu = document.querySelector('#options .options-content');
    if (!menu) {
        return;
    }
    // Next to ST's own "Delete messages"
    let after = document.getElementById('option_delete_mes');
    for (const [mode, { option, icon, label }] of Object.entries(MODES)) {
        const item = document.createElement('a');
        item.id = option;
        item.innerHTML = `<i class="fa-lg fa-solid ${icon}"></i><span>${label}</span>`;
        item.addEventListener('click', () => {
            // Close the Options menu the way its own button does, so it is out of the way
            if (document.getElementById('options')?.style.display !== 'none') {
                document.getElementById('options_button')?.click();
            }
            Promise.resolve(start(mode)).catch(error => console.error(`[${MODULE}] Range ${mode} failed`, error));
        });
        after ? after.after(item) : menu.append(item);
        after = item;
    }
    applyRangeDelete();
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, stop);
}
