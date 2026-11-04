// Chat shortcuts behind one small button: tap it to open the shortcuts, tap again to fold them.
// In the input bar (the shortcuts open as a row above the input, in the page flow, so they
// cover nothing) or floating (a small button stuck to a screen edge; long-press to move it).
// The floating position is kept as a share of the window, so it stays put after a rotation.
import { MODULE, getSettings, isOn } from './settings.js';
import { rerunLastQr } from './qr-input.js';
import { NAME_KINDS, getStoredName, setOverride, setOverrideEnabled, setStatusRealName, setNameSwap } from './name-override.js';

const PANEL_ID = 'stqa_floating_panel';
const INPUT_TOGGLE_ID = 'stqa_shortcuts_toggle';
const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE = 8; // px a finger may wobble before a press counts as a scroll attempt
const EDGE = 4;
const TITLE = '편의성 모음';

/** The buttons, in panel order; each can be switched off in the settings. */
export const FLOATING_BUTTONS = Object.freeze([
    { key: 'deleteLast', icon: 'fa-trash-can', label: '최근 메시지 삭제' },
    { key: 'top', icon: 'fa-angles-up', label: '맨 위로' },
    { key: 'jump', icon: 'fa-hashtag', label: '번호로 이동' },
    { key: 'bottom', icon: 'fa-angles-down', label: '맨 아래로' },
    { key: 'qrRerun', icon: 'fa-rotate-right', label: 'QR 다시 실행' },
    { key: 'names', icon: 'fa-id-badge', label: '이름 바꾸기' },
]);

export const FLOATING_LAYOUTS = Object.freeze([
    { value: 'input', label: '입력창 위에 펼치기' },
    { value: 'vertical', label: '떠 있는 버튼 (세로로 펼치기)' },
    { value: 'horizontal', label: '떠 있는 버튼 (가로로 펼치기)' },
]);

let panel = null;
let inputToggle = null;
let open = false;

async function jumpTo(messageId) {
    // /chat-jump loads older messages that aren't drawn yet, then scrolls to the one asked for
    await SillyTavern.getContext().executeSlashCommandsWithOptions(`/chat-jump ${messageId}`);
}

function scrollToBottom() {
    const chat = document.getElementById('chat');
    chat?.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

async function deleteLastMessage() {
    const context = SillyTavern.getContext();
    if (!context.chat.length) {
        toastr.info('메시지 없음', TITLE);
        return;
    }
    const confirmed = await context.Popup.show.confirm('최근 메시지 삭제', '되돌릴 수 없음');
    if (confirmed) {
        await context.deleteLastMessage();
    }
}

async function askAndJump() {
    const context = SillyTavern.getContext();
    const last = context.chat.length - 1;
    if (last < 0) {
        toastr.info('메시지 없음', TITLE);
        return;
    }
    const answer = await context.Popup.show.input('이동할 메시지 번호', `0 ~ ${last}`, '');
    if (answer === null || answer === false || String(answer).trim() === '') {
        return;
    }
    const number = Number(String(answer).trim().replace(/^#/, ''));
    if (!Number.isInteger(number) || number < 0 || number > last) {
        await context.Popup.show.text('없는 번호', `#0 ~ #${last}`);
        return;
    }
    await jumpTo(number);
}

const NAME_LABELS = Object.freeze({ char: '캐릭터', user: '사용자' });

/** Name replacement and the {{char}} ⇄ {{user}} swap in one window. */
async function editNames() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const content = document.createElement('div');
    content.className = 'stqa_names_form';
    content.innerHTML = `
        <h3>이름 바꾸기</h3>
        <label class="checkbox_label"><input type="checkbox" data-name="on"><span>다른 이름으로 바꾸기</span></label>
        <div class="stqa_name_grid">
            ${NAME_KINDS.map(kind => `
                <label class="stqa_name_label" for="stqa_name_${kind}">${NAME_LABELS[kind]}<small>{{${kind}}}</small></label>
                <input class="text_pole" type="text" id="stqa_name_${kind}" data-kind="${kind}">`).join('')}
        </div>
        <div class="stqa_hint">비워 두면 원래 이름을 씁니다.</div>
        <label class="checkbox_label"><input type="checkbox" data-name="swap"><span>{{char}}와 {{user}} 서로 바꾸기</span></label>
        <label class="checkbox_label"><input type="checkbox" data-name="status"><span>상태창에는 원래 이름 쓰기</span></label>`;
    const on = content.querySelector('[data-name="on"]');
    const swap = content.querySelector('[data-name="swap"]');
    const status = content.querySelector('[data-name="status"]');
    on.checked = settings.nameOverride;
    swap.checked = settings.nameSwap === true;
    status.checked = settings.statusRealName;
    for (const input of content.querySelectorAll('[data-kind]')) {
        input.value = getStoredName(input.dataset.kind);
        input.placeholder = (input.dataset.kind === 'char' ? context.name2 : context.name1) || '';
    }
    if (!await new context.Popup(content, context.POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소' }).show()) {
        return;
    }
    content.querySelectorAll('[data-kind]').forEach(input => setOverride(input.dataset.kind, input.value));
    setOverrideEnabled(on.checked);
    setNameSwap(swap.checked);
    setStatusRealName(status.checked);
    syncNamesButton();
}

/** The names button stands out while names are changed or swapped. */
function syncNamesButton() {
    const settings = getSettings();
    const active = settings.nameSwap === true || (settings.nameOverride && NAME_KINDS.some(kind => getStoredName(kind)));
    panel?.querySelector('[data-key="names"]')?.classList.toggle('stqa_on', Boolean(active));
}

const ACTIONS = {
    deleteLast: deleteLastMessage,
    names: editNames,
    top: () => jumpTo(0),
    jump: askAndJump,
    bottom: scrollToBottom,
    qrRerun: rerunLastQr,
};

function runAction(key) {
    Promise.resolve()
        .then(() => ACTIONS[key]?.())
        .catch(error => console.error(`[${MODULE}] Shortcut failed`, error));
}

const inInputBar = () => panel?.classList.contains('stqa_layout_input');

function place(x, y) {
    const box = panel.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, x), window.innerWidth - box.width - EDGE);
    const top = Math.min(Math.max(EDGE, y), window.innerHeight - box.height - EDGE);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    return { left, top };
}

/**
 * Floating: the saved spot (default: right edge, above the input bar), kept on screen as the
 * panel opens. In the input bar the row sits in the page flow and needs no position.
 */
function restorePosition() {
    if (inInputBar()) {
        return;
    }
    const inputTop = document.getElementById('send_form')?.getBoundingClientRect().top ?? window.innerHeight;
    const box = panel.getBoundingClientRect();
    const saved = getSettings().floatingPosition;
    const x = saved ? saved.x * window.innerWidth : window.innerWidth - box.width - EDGE * 2;
    const y = saved ? saved.y * window.innerHeight : inputTop - box.height - EDGE * 4;
    place(x, y);
}

function setOpen(value) {
    open = value;
    panel.classList.toggle('stqa_open', open);
    inputToggle?.classList.toggle('stqa_open', open);
    if (inInputBar()) {
        panel.hidden = !open || shownButtons() === 0;
    }
    if (!panel.hidden) {
        restorePosition();
    }
}

/**
 * Pointer handling: a short tap runs the button under the finger (or opens / folds the panel);
 * holding for a moment picks the floating panel up, and it follows the finger until released.
 */
function enableMoving() {
    let press = null;

    const end = (event) => {
        if (!press) {
            return;
        }
        clearTimeout(press.timer);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        const { dragging, moved, button } = press;
        press = null;
        panel.classList.remove('stqa_floating_dragging');
        if (dragging) {
            // Let go: it sticks to the nearer side edge, out of the way of the messages
            const box = panel.getBoundingClientRect();
            const toLeft = box.left + box.width / 2 < window.innerWidth / 2;
            const { left, top } = place(toLeft ? EDGE : window.innerWidth, box.top);
            getSettings().floatingPosition = { x: left / window.innerWidth, y: top / window.innerHeight };
            SillyTavern.getContext().saveSettingsDebounced();
        } else if (!moved && button && event.type === 'pointerup') {
            button.dataset.key === 'toggle' ? setOpen(!open) : runAction(button.dataset.key);
        }
    };

    const onMove = (event) => {
        if (!press) {
            return;
        }
        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;
        if (press.dragging) {
            event.preventDefault();
            place(press.left + dx, press.top + dy);
        } else if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
            // Moved before the hold finished: not a tap, not a drag
            press.moved = true;
            clearTimeout(press.timer);
        }
    };

    panel.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        const box = panel.getBoundingClientRect();
        press = {
            x: event.clientX, y: event.clientY, left: box.left, top: box.top,
            button: event.target.closest('[data-key]'), dragging: false, moved: false,
        };
        press.timer = setTimeout(() => {
            if (press && !press.moved && !inInputBar()) {
                press.dragging = true;
                panel.classList.add('stqa_floating_dragging');
                navigator.vibrate?.(15);
            }
        }, LONG_PRESS_MS);
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
    });
    // Holding must not open the phone's context menu or start a text selection
    panel.addEventListener('contextmenu', event => event.preventDefault());
}

function build() {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    const toggle = document.createElement('div');
    toggle.className = 'stqa_floating_button stqa_floating_toggle fa-solid fa-ellipsis';
    toggle.dataset.key = 'toggle';
    toggle.title = '바로가기 펼치기/접기 (꾹 누르면 위치 이동)';
    panel.append(toggle);
    for (const { key, icon, label } of FLOATING_BUTTONS) {
        const button = document.createElement('div');
        button.className = `stqa_floating_button fa-solid ${icon}`;
        button.dataset.key = key;
        button.title = label;
        panel.append(button);
    }
    document.body.append(panel);
    enableMoving();
    window.addEventListener('resize', () => panel.isConnected && !panel.hidden && restorePosition());
    // Floating, scrolling elsewhere by hand (finger or wheel) folds it; scrolls the buttons do
    // themselves don't. The input bar row covers nothing, so it stays until ⋯ is tapped again.
    const foldOnScroll = (event) => {
        if (open && !inInputBar() && !panel.contains(event.target)) {
            setOpen(false);
        }
    };
    document.addEventListener('touchmove', foldOnScroll, { passive: true, capture: true });
    document.addEventListener('wheel', foldOnScroll, { passive: true, capture: true });
}

/** The input bar button that opens the shortcuts (input bar layout only). */
function syncInputToggle(wanted) {
    if (!wanted) {
        inputToggle?.remove();
        inputToggle = null;
        return;
    }
    if (!inputToggle) {
        inputToggle = document.createElement('div');
        inputToggle.id = INPUT_TOGGLE_ID;
        inputToggle.className = 'fa-solid fa-ellipsis interactable';
        inputToggle.title = '바로가기';
        inputToggle.tabIndex = 0;
        inputToggle.addEventListener('click', () => setOpen(!open));
    }
    if (!inputToggle.isConnected) {
        document.getElementById('leftSendForm')?.append(inputToggle);
    }
}

const shownButtons = () => [...panel.querySelectorAll('[data-key]:not([data-key="toggle"])')].filter(button => !button.hidden).length;

/** Shows the buttons switched on (the panel shrinks to fit), in the chosen layout, or hides it all. */
export function applyFloatingSettings() {
    const settings = getSettings();
    if (!panel) {
        build();
    }
    for (const button of panel.querySelectorAll('[data-key]:not([data-key="toggle"])')) {
        // Buttons added in later versions start switched on
        button.hidden = settings.floatingButtons?.[button.dataset.key] === false;
    }
    const layout = FLOATING_LAYOUTS.some(({ value }) => value === settings.floatingLayout) ? settings.floatingLayout : 'input';
    for (const { value } of FLOATING_LAYOUTS) {
        panel.classList.toggle(`stqa_layout_${value}`, value === layout);
    }
    // In the input bar the row goes right above the input, in the flow; floating, on the page
    const form = document.getElementById('send_form');
    if (layout === 'input' && form) {
        form.before(panel);
        panel.style.left = panel.style.top = '';
    } else if (panel.parentElement !== document.body) {
        document.body.append(panel);
    }
    const enabled = isOn('floatingPanel') && shownButtons() > 0;
    syncNamesButton();
    syncInputToggle(enabled && layout === 'input');
    panel.hidden = !enabled || (layout === 'input' && !open);
    setOpen(enabled && open);
}

export function initFloatingPanel() {
    applyFloatingSettings();
}
