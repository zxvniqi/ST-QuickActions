// Chat shortcuts behind one small button: tap it to open the shortcuts, tap again to fold them.
// Floating (in a column or a row; long-press to move it) or as a button in the input bar.
// The floating position is kept as a share of the window, so it stays put after a rotation.
import { MODULE, getSettings, isOn } from './settings.js';
import { rerunLastQr } from './qr-input.js';
import { NAME_KINDS, getStoredName, setOverride, setOverrideEnabled, setStatusRealName, setNameSwap } from './name-override.js';

const PANEL_ID = 'stqa_floating_panel';
const INPUT_TOGGLE_ID = 'stqa_shortcuts_toggle';
const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE = 8; // px a finger may wobble before a press counts as a scroll attempt
const EDGE = 6;
const TITLE = '편의성 모음';

/** The buttons, in panel order; each can be switched off in the settings. */
export const FLOATING_BUTTONS = Object.freeze([
    { key: 'deleteLast', icon: 'fa-trash-can', label: '최근 메시지 삭제' },
    { key: 'top', icon: 'fa-angles-up', label: '채팅 맨 위로 (#0)' },
    { key: 'jump', icon: 'fa-hashtag', label: '번호로 이동' },
    { key: 'bottom', icon: 'fa-angles-down', label: '채팅 맨 아래로' },
    { key: 'qrRerun', icon: 'fa-rotate-right', label: '마지막 QR 같은 입력으로 다시' },
    { key: 'names', icon: 'fa-id-badge', label: '이름 치환' },
    { key: 'swap', icon: 'fa-right-left', label: '{{char}} ⇄ {{user}} 교환 켜기/끄기' },
]);

export const FLOATING_LAYOUTS = Object.freeze([
    { value: 'vertical', label: '세로' },
    { value: 'horizontal', label: '가로' },
    { value: 'input', label: '입력창에' },
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

/** Name replacement: on / off, the names for {{char}} / {{user}}, and the status panel option. */
async function editNames() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const content = document.createElement('div');
    content.className = 'stqa_names_form';
    content.innerHTML = `
        <h3>이름 치환</h3>
        <label class="checkbox_label"><input type="checkbox" data-name="on"><span>켜기</span></label>
        ${NAME_KINDS.map(kind => `<label class="stqa_name_field"><span>{{${kind}}}</span><input class="text_pole" type="text" data-kind="${kind}"></label>`).join('')}
        <label class="checkbox_label"><input type="checkbox" data-name="status"><span>상태창에는 원래 이름</span></label>
        <small class="stqa_hint">비우면 원래 이름</small>`;
    const on = content.querySelector('[data-name="on"]');
    const status = content.querySelector('[data-name="status"]');
    on.checked = settings.nameOverride;
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
    setStatusRealName(status.checked);
}

function toggleSwap() {
    const on = !getSettings().nameSwap;
    setNameSwap(on);
    syncSwapButton();
    toastr.info(on ? '{{char}} ⇄ {{user}} 교환 켬' : '{{char}} ⇄ {{user}} 교환 끔', TITLE);
}

function syncSwapButton() {
    panel?.querySelector('[data-key="swap"]')?.classList.toggle('stqa_on', getSettings().nameSwap === true);
}

const ACTIONS = {
    deleteLast: deleteLastMessage,
    names: editNames,
    swap: toggleSwap,
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

const inInputBar = () => getSettings().floatingLayout === 'input';

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
 * panel opens. In the input bar: the shortcuts open as a row right above the bar.
 */
function restorePosition() {
    const inputTop = document.getElementById('send_form')?.getBoundingClientRect().top ?? window.innerHeight;
    const box = panel.getBoundingClientRect();
    if (inInputBar()) {
        const toggleLeft = inputToggle?.getBoundingClientRect().left ?? EDGE;
        place(toggleLeft, inputTop - box.height - EDGE);
        return;
    }
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
            const box = panel.getBoundingClientRect();
            getSettings().floatingPosition = { x: box.left / window.innerWidth, y: box.top / window.innerHeight };
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
    // In the input bar, a tap elsewhere folds the row away
    document.addEventListener('pointerdown', (event) => {
        if (open && inInputBar() && !panel.contains(event.target) && !inputToggle?.contains(event.target)) {
            setOpen(false);
        }
    });
    // Scrolling elsewhere by hand (finger or wheel) folds it; scrolls the buttons do themselves don't
    const foldOnScroll = (event) => {
        if (open && !panel.contains(event.target) && !inputToggle?.contains(event.target)) {
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
    const layout = FLOATING_LAYOUTS.some(({ value }) => value === settings.floatingLayout) ? settings.floatingLayout : 'vertical';
    for (const { value } of FLOATING_LAYOUTS) {
        panel.classList.toggle(`stqa_layout_${value}`, value === layout);
    }
    const enabled = isOn('floatingPanel') && shownButtons() > 0;
    syncSwapButton();
    syncInputToggle(enabled && layout === 'input');
    panel.hidden = !enabled || (layout === 'input' && !open);
    setOpen(enabled && open);
}

export function initFloatingPanel() {
    applyFloatingSettings();
}
