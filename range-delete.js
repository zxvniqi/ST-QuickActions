// "메시지 범위 삭제" in the Options menu: tap the first and the last message of a range, then
// confirm. Everything between them is deleted (unlike ST's own delete, which takes everything
// below the picked message).
import { MODULE, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_range_delete';
const BANNER_ID = 'stqa_range_banner';
const MODE_CLASS = 'stqa_range_mode';
const PICKED_CLASS = 'stqa_range_picked';
const TITLE = '편의성 모음';

let first = null;
let banner = null;

function messageIdOf(element) {
    const id = Number(element?.closest('#chat .mes')?.getAttribute('mesid'));
    return Number.isInteger(id) ? id : null;
}

function mark(from, to) {
    for (const element of document.querySelectorAll('#chat .mes')) {
        const id = messageIdOf(element);
        element.classList.toggle(PICKED_CLASS, id !== null && id >= from && id <= to);
    }
}

function stop() {
    first = null;
    document.body.classList.remove(MODE_CLASS);
    document.querySelectorAll(`.${PICKED_CLASS}`).forEach(element => element.classList.remove(PICKED_CLASS));
    banner?.remove();
    banner = null;
    document.removeEventListener('click', onPick, true);
}

function showBanner(text) {
    if (!banner) {
        banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.innerHTML = '<span></span><div class="menu_button">취소</div>';
        banner.querySelector('.menu_button').addEventListener('click', stop);
        document.body.append(banner);
    }
    banner.querySelector('span').textContent = text;
}

async function onPick(event) {
    if (banner?.contains(event.target)) {
        return;
    }
    const id = messageIdOf(event.target);
    if (id === null) {
        return;
    }
    // In this mode a tap on a message only picks it
    event.preventDefault();
    event.stopPropagation();
    if (first === null) {
        first = id;
        mark(id, id);
        showBanner(`#${id}부터. 끝 메시지 선택`);
        return;
    }
    const [from, to] = [Math.min(first, id), Math.max(first, id)];
    mark(from, to);
    const { Popup, executeSlashCommandsWithOptions } = SillyTavern.getContext();
    const confirmed = await Popup.show.confirm(`#${from} ~ #${to} 삭제`, `${to - from + 1}개. 되돌릴 수 없음`, { okButton: '삭제', cancelButton: '취소' });
    stop();
    if (confirmed) {
        await executeSlashCommandsWithOptions(`/cut ${from}-${to}`);
        toastr.success(`#${from} ~ #${to} 삭제됨`, TITLE);
    }
}

function start() {
    if (!SillyTavern.getContext().chat.length) {
        toastr.info('메시지 없음', TITLE);
        return;
    }
    stop();
    document.body.classList.add(MODE_CLASS);
    showBanner('첫 메시지 선택');
    // Added after the menu's own click, so the tap that opened this doesn't pick a message
    setTimeout(() => document.addEventListener('click', onPick, true));
}

export function applyRangeDelete() {
    const item = document.getElementById(OPTION_ID);
    if (item) {
        item.hidden = !isOn('rangeDelete');
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
        Promise.resolve(start()).catch(error => console.error(`[${MODULE}] Range delete failed`, error));
    });
    // Next to ST's own "Delete messages"
    const own = document.getElementById('option_delete_mes');
    own ? own.after(item) : menu.append(item);
    applyRangeDelete();
}
