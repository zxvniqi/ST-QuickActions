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

// While picking (here, or in ST's own "Delete messages"): the shortcuts' move buttons (those
// switched on), on buttons of their own (the shortcut panel sits by the input bar, which is hidden)
const STEPS_ID = 'stqa_range_steps';
const STEP_BUTTONS = Object.freeze([
    { key: 'top', icon: 'fa-angles-up', title: '맨 위로', side: 0 },
    { key: 'up', icon: 'fa-angle-up', title: '한 메시지 위로', side: 0 },
    { key: 'down', icon: 'fa-angle-down', title: '한 메시지 아래로', side: 1 },
    { key: 'bottom', icon: 'fa-angles-down', title: '맨 아래로', side: 1 },
]);

function showSteps() {
    document.getElementById(STEPS_ID)?.remove();
    // A switch of their own (not the shortcuts')
    const shown = isOn('rangeStepButtons') ? STEP_BUTTONS : [];
    if (!shown.length) {
        return;
    }
    const steps = document.createElement('div');
    steps.id = STEPS_ID;
    // Upward ones at the left edge, downward ones at the right
    const sides = [document.createElement('div'), document.createElement('div')];
    sides.forEach(side => side.className = 'stqa_range_steps_side');
    for (const { key, icon, title, side } of shown) {
        const button = document.createElement('div');
        button.className = `stqa_range_step fa-solid ${icon}`;
        button.title = title;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            document.dispatchEvent(new CustomEvent('stqa-shortcut', { detail: key }));
        });
        sides[side].append(button);
    }
    steps.append(...sides);
    document.body.append(steps);
    // A row right above the bar standing in for the input. Measured: some themes make the page a box a fixed
    // button can't be put at the bottom of
    const barTop = document.getElementById('dialogue_del_mes')?.getBoundingClientRect().top ?? window.innerHeight;
    const origin = steps.getBoundingClientRect().top - steps.offsetTop;
    steps.style.top = `${Math.max(8, barTop - steps.offsetHeight - 12) - origin}px`;
}

/** The buttons come and go with the bar (ST's delete mode and this one both show it). */
/** The buttons as the delete bar and the settings are now (`again`: drawn anew where they are). */
function syncSteps(again = false) {
    const bar = document.getElementById('dialogue_del_mes');
    const shown = Boolean(bar) && getComputedStyle(bar).display !== 'none';
    const steps = document.getElementById(STEPS_ID);
    if (shown && (!steps || again)) {
        showSteps();
    } else if (!shown && steps) {
        steps.remove();
    }
}

function watchBar() {
    const bar = document.getElementById('dialogue_del_mes');
    if (!bar) {
        return;
    }
    new MutationObserver(() => syncSteps()).observe(bar, { attributes: true, attributeFilter: ['style', 'class'] });
    // (The screen turned or resized: placed again over the bar)
    window.addEventListener('resize', () => document.getElementById(STEPS_ID) && syncSteps(true));
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
    // (Not while a reply is being written: the last messages are still changing)
    // (The input bar is hidden in this mode, so the stop button is asked how it is set to show)
    const stopButton = document.getElementById('mes_stop');
    if (picked && stopButton && getComputedStyle(stopButton).display !== 'none') {
        toastr.info('답변 생성 중에는 할 수 없습니다.', TITLE);
        return;
    }
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
    // Chat search standing in for the input: closed first (so the input bar comes back after)
    document.querySelector('#stqa_search_bar [data-step="close"]')?.click();
    formDisplay = form.style.display === 'none' ? '' : form.style.display;
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
 * Hides the messages from one number to another, for the shortcut button: "[ ] 부터 [ ] 까지".
 * Hidden messages stay in the chat (ST leaves them out of the prompt); the eye on a message shows it again.
 */
export async function askAndHideRange() {
    const { chat, Popup, POPUP_TYPE, POPUP_RESULT, executeSlashCommandsWithOptions, getCurrentChatId } = SillyTavern.getContext();
    const chatId = getCurrentChatId();
    const last = chat.length - 1;
    if (last < 0) {
        toastr.info('메시지가 없습니다.', TITLE);
        return;
    }
    const content = document.createElement('div');
    content.className = 'stqa_hide_range';
    content.innerHTML = `
        <h3>메시지 범위 숨기기</h3>
        <div class="stqa_hide_range_row">
            <input class="text_pole" type="number" inputmode="numeric" min="0" max="${last}" data-end="from"><span>부터</span>
            <input class="text_pole" type="number" inputmode="numeric" min="0" max="${last}" data-end="to"><span>까지</span>
        </div>
        <div class="stqa_hint">메시지 번호: 0 ~ ${last}</div>`;
    const from = content.querySelector('[data-end="from"]');
    const to = content.querySelector('[data-end="to"]');
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '숨기기', cancelButton: '취소' });
    const shown = popup.show();
    from.focus();
    // Enter in the first box goes on to the second; in the second it hides
    from.addEventListener('keydown', event => event.key === 'Enter' && (event.preventDefault(), to.focus()));
    // (Another chat opened meanwhile: its messages aren't the ones numbered here)
    if (await shown !== POPUP_RESULT.AFFIRMATIVE || SillyTavern.getContext().getCurrentChatId() !== chatId) {
        return;
    }
    const values = [from.value, to.value].map(value => value.trim());
    const numbers = values.map(Number);
    if (values.includes('') || !numbers.every(number => Number.isInteger(number) && number >= 0 && number <= last)) {
        await Popup.show.text('없는 번호', `두 칸 모두 0 ~ ${last} 사이 번호로 적어 주세요.`);
        return;
    }
    await executeSlashCommandsWithOptions(`/hide ${Math.min(...numbers)}-${Math.max(...numbers)}`);
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
    // (The floating buttons switched off or changed while the bar is up)
    syncSteps(true);
}

export function initRangeDelete() {
    watchBar();
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
