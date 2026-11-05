// Chat shortcuts behind one small button: tap it to open the shortcuts, tap again to fold them.
// In the input bar (the shortcuts open as a row above the input, in the page flow, so they
// cover nothing) or floating (a small button stuck to a screen edge; long-press to move it).
// The floating position is kept as a share of the window, so it stays put after a rotation.
import { MODULE, getSettings, isOn } from './settings.js';
import { getStoredName, setOverride, setOverrideEnabled, setStatusRealName, setNameSwap } from './name-override.js';

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
    { key: 'names', icon: 'fa-id-badge', label: '이름 바꾸기' },
]);

/** The buttons in the order set in the settings (long-press a chip there to move it). */
export function orderedFloatingButtons() {
    const order = getSettings().floatingOrder ?? [];
    const rank = key => (order.includes(key) ? order.indexOf(key) : order.length);
    return [...FLOATING_BUTTONS].sort((a, b) => rank(a.key) - rank(b.key));
}

export const FLOATING_LAYOUTS = Object.freeze([
    { value: 'input', label: '입력창 위에 펼치기 (⋯ 버튼)' },
    { value: 'fixed', label: '입력창 위에 항상 보이기' },
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

/**
 * Moves the chat to a spot and keeps it there while messages and pictures are still being
 * drawn (a smooth scroll stops halfway when the chat grows under it). `target` gives the
 * scroll position wanted, asked again each frame as things move.
 */
function settle(chat, target) {
    let frame = 0;
    let steady = 0;
    let last = null;
    let height = null;
    // The user scrolling by hand takes over
    const stopNow = () => (frame = Infinity);
    chat.addEventListener('touchstart', stopNow, { once: true, passive: true });
    chat.addEventListener('wheel', stopNow, { once: true, passive: true });
    const step = () => {
        if (frame === Infinity) {
            chat.removeEventListener('wheel', stopNow);
            return;
        }
        chat.scrollTo({ top: target(), behavior: 'instant' });
        steady = chat.scrollTop === last && chat.scrollHeight === height ? steady + 1 : 0;
        last = chat.scrollTop;
        height = chat.scrollHeight;
        // Until nothing has moved for a while (about half a second), at most about 3 seconds
        if (steady < 30 && ++frame < 180) {
            requestAnimationFrame(step);
        } else {
            chat.removeEventListener('touchstart', stopNow);
            chat.removeEventListener('wheel', stopNow);
        }
    };
    step();
}

/** The chat's top or bottom end. */
function settleAtEnd(top) {
    const chat = document.getElementById('chat');
    chat && settle(chat, () => (top ? 0 : chat.scrollHeight));
}

/** The message's top edge at the top of the chat. */
function settleAtMessage(messageId) {
    const chat = document.getElementById('chat');
    const message = chat?.querySelector(`.mes[mesid="${messageId}"]`);
    message && settle(chat, () => chat.scrollTop + message.getBoundingClientRect().top - chat.getBoundingClientRect().top);
}

async function scrollToTop() {
    // Older messages that aren't drawn yet are loaded first
    await jumpTo(0);
    settleAtEnd(true);
}

function scrollToBottom() {
    settleAtEnd(false);
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
    // ST's smooth scroll stops short when messages above are still growing
    settleAtMessage(number);
}

// Fields in the order the user reads them
const NAME_ORDER = Object.freeze(['char', 'user']);

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
            ${NAME_ORDER.map(kind => `
                <label class="stqa_name_label" for="stqa_name_${kind}">{{${kind}}}</label>
                <input class="text_pole" type="text" id="stqa_name_${kind}" data-kind="${kind}">`).join('')}
        </div>
        <div class="stqa_hint">비워 두면 원래 이름을 씁니다.</div>
        <label class="stqa_swap_row">
            <input type="checkbox" data-name="swap">
            <i class="fa-solid fa-right-left"></i>
            <span>{{user}} ⇄ {{char}} 서로 바꾸기</span>
            <b class="stqa_swap_state"></b>
        </label>
        <label class="checkbox_label"><input type="checkbox" data-name="status"><span>상태창에는 원래 이름 쓰기</span></label>`;
    const on = content.querySelector('[data-name="on"]');
    const swap = content.querySelector('[data-name="swap"]');
    const status = content.querySelector('[data-name="status"]');
    on.checked = settings.nameOverride;
    swap.checked = settings.nameSwap === true;
    status.checked = settings.statusRealName;
    // While swapping, the row says so plainly
    const showSwap = () => {
        content.querySelector('.stqa_swap_row').classList.toggle('stqa_on', swap.checked);
        content.querySelector('.stqa_swap_state').textContent = swap.checked ? '교체 중' : '꺼짐';
    };
    swap.addEventListener('change', showSwap);
    showSwap();
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

/** While {{char}} and {{user}} are swapped, the names button carries a ⇄ mark. */
function syncNamesButton() {
    panel?.querySelector('[data-key="names"]')?.classList.toggle('stqa_swapping', getSettings().nameSwap === true);
}

const ACTIONS = {
    deleteLast: deleteLastMessage,
    names: editNames,
    top: scrollToTop,
    jump: askAndJump,
    bottom: scrollToBottom,
};

function runAction(key) {
    Promise.resolve()
        .then(() => ACTIONS[key]?.())
        .catch(error => console.error(`[${MODULE}] Shortcut failed`, error));
}

// Input bar layouts: a row in the page flow right above the input
const IN_FLOW = Object.freeze(['input', 'fixed']);
const inInputBar = () => panel?.classList.contains('stqa_in_flow');

function place(x, y) {
    const box = panel.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, x), window.innerWidth - box.width - EDGE);
    const top = Math.min(Math.max(EDGE, y), window.innerHeight - box.height - EDGE);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    return { left, top };
}

const toggleOf = () => panel.querySelector('.stqa_floating_toggle');

/** Where ··· sits on screen (saved; default: right edge, above the input bar). */
function anchorSpot() {
    const saved = getSettings().floatingPosition;
    if (saved) {
        return { x: saved.x * window.innerWidth, y: saved.y * window.innerHeight };
    }
    const size = toggleOf().getBoundingClientRect();
    const inputTop = document.getElementById('send_form')?.getBoundingClientRect().top ?? window.innerHeight;
    return { x: window.innerWidth - size.width - EDGE * 4, y: inputTop - size.height - EDGE * 6 };
}

/**
 * Floating: ··· stays where it is and the buttons open out from it, toward the side with more
 * room (left / up near the right / bottom, so ··· ends up last), so a second tap on the same
 * spot folds it again. In the input bar the row sits in the page flow and needs no position.
 */
function restorePosition() {
    if (inInputBar()) {
        return;
    }
    const { x, y } = anchorSpot();
    const vertical = panel.classList.contains('stqa_layout_vertical');
    panel.classList.toggle('stqa_grow_back', open && (vertical ? y > window.innerHeight / 2 : x > window.innerWidth / 2));
    const box = panel.getBoundingClientRect();
    const toggle = toggleOf().getBoundingClientRect();
    place(x - (toggle.left - box.left), y - (toggle.top - box.top));
}

/** Remembers where ··· is now (after a move), as a share of the window. */
function saveAnchor() {
    const toggle = toggleOf().getBoundingClientRect();
    getSettings().floatingPosition = { x: toggle.left / window.innerWidth, y: toggle.top / window.innerHeight };
    SillyTavern.getContext().saveSettingsDebounced();
}

/** The buttons look like ST's own input bar buttons (color, dimming) in whatever theme is on. */
function matchTheme() {
    const reference = document.getElementById('options_button');
    if (!reference) {
        return;
    }
    const { color, opacity } = getComputedStyle(reference);
    panel.style.setProperty('--stqa_shortcut_color', color);
    panel.style.setProperty('--stqa_shortcut_opacity', opacity);
}

function setOpen(value) {
    open = value;
    matchTheme();
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
            place(toLeft ? EDGE : window.innerWidth, box.top);
            saveAnchor();
            // Open, it may now have to open out the other way from ···
            open && restorePosition();
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
    // Open stays open (scrolling the chat doesn't fold it) until ⋯ is tapped again
    window.addEventListener('resize', () => panel.isConnected && !panel.hidden && restorePosition());
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
    matchTheme();
    for (const { key } of orderedFloatingButtons()) {
        const button = panel.querySelector(`:scope > [data-key="${key}"]`);
        // Buttons added in later versions start switched on
        button.hidden = settings.floatingButtons?.[key] === false;
        panel.append(button);
    }
    const layout = FLOATING_LAYOUTS.some(({ value }) => value === settings.floatingLayout) ? settings.floatingLayout : 'input';
    // Leaving "always shown" starts the new layout folded
    if (panel.classList.contains('stqa_layout_fixed') && layout !== 'fixed') {
        open = false;
    }
    for (const { value } of FLOATING_LAYOUTS) {
        panel.classList.toggle(`stqa_layout_${value}`, value === layout);
    }
    // In the input bar the row goes in the flow, under the Quick Reply bar and right above the
    // input (Quick Reply puts a redrawn bar first in the form, so it stays above); floating, on the page
    const inFlow = IN_FLOW.includes(layout);
    panel.classList.toggle('stqa_in_flow', inFlow);
    const form = document.getElementById('send_form');
    if (inFlow && form) {
        const qrBar = form.querySelector(':scope > #qr--bar');
        if (qrBar) {
            qrBar.nextElementSibling !== panel && qrBar.after(panel);
        } else if (panel.parentElement !== form) {
            form.prepend(panel);
        }
        panel.style.left = panel.style.top = '';
    } else if (panel.parentElement !== document.body) {
        document.body.append(panel);
    }
    const enabled = isOn('floatingPanel') && shownButtons() > 0;
    // Always shown: open for good, with no ⋯ to fold it
    if (layout === 'fixed') {
        open = true;
    }
    syncNamesButton();
    syncInputToggle(enabled && layout === 'input');
    panel.hidden = !enabled || (inFlow && !open);
    setOpen(enabled && open);
}

export function initFloatingPanel() {
    applyFloatingSettings();
    // The theme may still be loading when this extension starts
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, matchTheme);
}
