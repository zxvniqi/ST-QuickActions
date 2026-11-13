// Chat shortcuts behind one small button: tap it to open the shortcuts, tap again to fold them.
// In the input bar (the shortcuts open as a row above the input, in the page flow, so they
// cover nothing) or floating (a small button stuck to a screen edge; long-press to move it).
// The floating position is kept as a share of the window, so it stays put after a rotation.
import { MODULE, getSettings, isOn } from './settings.js';
import { getStoredName, setOverride, setOverrideEnabled, setStatusRealName, setNameSwap } from './name-override.js';
import { askAndHideRange } from './range-delete.js';
import { findMenuItem, listItems } from './layout-manager.js';
import { extensionLinkButtons, openExtensionLink } from './extension-links.js';
import { showMoreMessages } from '../../../../script.js';
import { flashHighlight } from '../../../utils.js';

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
    { key: 'up', icon: 'fa-angle-up', label: '한 메시지 위로' },
    { key: 'jump', icon: 'fa-hashtag', label: '번호로 이동' },
    { key: 'down', icon: 'fa-angle-down', label: '한 메시지 아래로' },
    { key: 'bottom', icon: 'fa-angles-down', label: '맨 아래로' },
    { key: 'hideRange', icon: 'fa-eye-slash', label: '메시지 범위 숨기기' },
    { key: 'names', icon: 'fa-id-badge', label: '이름 바꾸기' },
]);

/**
 * The buttons in the order set in the settings (long-press a chip there to move it). Buttons
 * that order doesn't know yet (added in later versions) go right after the button they follow
 * in the default order.
 */
export function orderedFloatingButtons() {
    const buttons = [...FLOATING_BUTTONS, ...extraButtons(), ...extensionLinkButtons()];
    const keys = buttons.map(button => button.key);
    const order = (getSettings().floatingOrder ?? []).filter(key => keys.includes(key));
    keys.forEach((key, index) => {
        if (!order.includes(key)) {
            const previous = keys.slice(0, index).findLast(other => order.includes(other));
            order.splice(previous ? order.indexOf(previous) + 1 : 0, 0, key);
        }
    });
    return order.map(key => buttons.find(button => button.key === key));
}

/** Where menu items can be taken from for the shortcuts. */
export const MENU_SOURCES = Object.freeze([
    { title: '확장 메뉴 (마법봉)', selectors: ['#extensionsMenu'] },
    { title: '옵션 메뉴 (☰)', selectors: ['#options .options-content'] },
    { title: '입력창 버튼', selectors: ['#leftSendForm', '#rightSendForm'] },
]);
const FALLBACK_ICON = 'fa-solid fa-puzzle-piece';
// Size classes a menu icon may carry (fa-lg in the Options menu): the shortcuts size their icons themselves
const iconWithoutSize = icon => icon.split(/\s+/).filter(name => name && !/^fa-(lg|xl|2xl|xs|sm|2xs|fw|\d+x)$/.test(name)).join(' ');
const extraKey = (selector, key) => `menu:${selector}|${key}`;

/** Menu items added to the shortcuts (settings: { selector, key, label, icon }). */
function extraButtons() {
    return (getSettings().floatingExtras ?? []).map(item => ({
        key: extraKey(item.selector, item.key),
        icon: iconWithoutSize(item.icon || '') || FALLBACK_ICON,
        label: item.label,
        menuItem: item,
    }));
}

/** Taps the menu item a shortcut stands for, where the page has it (the menu needn't be open). */
function runMenuItem(key) {
    const item = (getSettings().floatingExtras ?? []).find(entry => extraKey(entry.selector, entry.key) === key);
    const element = item && findMenuItem(item.selector, item.key);
    if (!element) {
        toastr.warning(`"${item?.label ?? '?'}" 항목을 찾지 못했습니다. 그 확장이 꺼져 있거나 이름이 바뀌었을 수 있습니다.`, TITLE);
        return;
    }
    element.click();
}

/**
 * Picks menu items to add to the shortcuts: the wand menu, the Options menu and the input bar
 * buttons, each with its icon and name; the ones added already come ticked.
 * @returns {Promise<boolean>} whether the list was changed
 */
export async function pickMenuItems() {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const settings = getSettings();
    const chosen = new Set((settings.floatingExtras ?? []).map(item => extraKey(item.selector, item.key)));
    const entries = new Map();
    const root = document.createElement('div');
    root.className = 'stqa_panel stqa_menu_pick';
    root.innerHTML = '<h3>바로가기에 메뉴 항목 추가</h3><div class="stqa_hint">고른 항목이 바로가기 줄에 아이콘으로 생깁니다. 누르면 원래 메뉴에서 누른 것과 같습니다.</div>';
    for (const { title, selectors } of MENU_SOURCES) {
        // The shortcuts' own ··· isn't one to add
        const items = selectors.flatMap(selector => listItems(selector, { natural: true }).map(item => ({ ...item, selector })))
            .filter(item => item.key !== INPUT_TOGGLE_ID);
        if (!items.length) {
            continue;
        }
        const group = document.createElement('div');
        group.className = 'stqa_menu_pick_group';
        group.innerHTML = '<div class="stqa_layout_group_title"></div>';
        group.firstElementChild.textContent = title;
        for (const item of items) {
            const key = extraKey(item.selector, item.key);
            entries.set(key, { selector: item.selector, key: item.key, label: item.label, icon: item.icon });
            const row = document.createElement('label');
            row.className = 'stqa_menu_pick_row';
            row.innerHTML = '<input type="checkbox"><i></i><span></span>';
            row.querySelector('input').dataset.key = key;
            row.querySelector('input').checked = chosen.has(key);
            row.querySelector('i').className = item.icon || FALLBACK_ICON;
            row.querySelector('span').textContent = item.label;
            group.append(row);
        }
        root.append(group);
    }
    const result = await new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소', leftAlign: true, allowVerticalScrolling: true }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }
    const ticked = [...root.querySelectorAll('input:checked')].map(input => input.dataset.key);
    // Items added before that aren't on the page right now (an extension switched off) stay
    const kept = (settings.floatingExtras ?? []).filter(item => !entries.has(extraKey(item.selector, item.key)));
    settings.floatingExtras = [...kept, ...ticked.map(key => entries.get(key))];
    SillyTavern.getContext().saveSettingsDebounced();
    applyFloatingSettings();
    return true;
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

/**
 * Draws the older messages down to this one if they aren't drawn yet. Scrolling is left to the
 * caller: /chat-jump also starts a smooth scroll of its own, which on phones kept going against
 * the settling (and the finger) and could throw the chat to another message seconds later.
 */
async function jumpTo(messageId) {
    const first = Number(document.querySelector('#chat > .mes[mesid]')?.getAttribute('mesid'));
    if (Number.isInteger(first) && messageId < first) {
        await showMoreMessages(first - messageId);
    }
}

/**
 * Moves the chat to a spot and keeps it there while messages and pictures are still being
 * drawn (a smooth scroll stops halfway when the chat grows under it). `target` gives the
 * scroll position wanted, asked again each frame as things move.
 */
// The settling in progress: a new one (a second tap) takes over from it
let settling = 0;

/**
 * Whether the chat was scrolled by hand since `spot` ({ top, height } taken right after our own
 * scroll). A finger on a status panel or HTML card (an iframe) sends no touch event to the page,
 * so the scroll itself is what tells: it moved while the chat's height stayed the same (a
 * message growing above moves it too, but changes the height).
 */
const scrolledByHand = (chat, spot) => Math.abs(chat.scrollTop - spot.top) > 4 && chat.scrollHeight === spot.height;
const spotOf = chat => ({ top: chat.scrollTop, height: chat.scrollHeight });

// The longest a move waits for the pictures where it lands
const PICTURE_WAIT_MS = 300;

/**
 * Loads and decodes the pictures of the messages a move lands on, before moving. Performance
 * Optimizer and the like make chat pictures load only when they come near and decode later;
 * landing on them in one go showed blank boxes that then popped in and pushed the text (a stutter).
 */
function preparePictures(messages) {
    const pictures = messages.filter(Boolean).flatMap(message => [...message.querySelectorAll('.mes_text img')]);
    if (!pictures.length) {
        return Promise.resolve();
    }
    for (const picture of pictures) {
        picture.loading === 'lazy' && (picture.loading = 'eager');
    }
    const decoded = Promise.all(pictures.map(picture => picture.decode().catch(() => {})));
    return Promise.race([decoded, new Promise(resolve => setTimeout(resolve, PICTURE_WAIT_MS))]);
}

function settle(chat, target) {
    const run = ++settling;
    let frame = 0;
    let steady = 0;
    let last = null;
    let height = null;
    let spot = null;
    // The user scrolling by hand takes over
    const stopNow = () => (frame = Infinity);
    chat.addEventListener('touchstart', stopNow, { once: true, passive: true });
    chat.addEventListener('wheel', stopNow, { once: true, passive: true });
    const step = () => {
        if (run !== settling || (spot && scrolledByHand(chat, spot))) {
            frame = Infinity;
        }
        if (frame === Infinity) {
            chat.removeEventListener('touchstart', stopNow);
            chat.removeEventListener('wheel', stopNow);
            return;
        }
        chat.scrollTo({ top: target(), behavior: 'instant' });
        spot = spotOf(chat);
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
async function settleAtMessage(messageId) {
    const chat = document.getElementById('chat');
    const message = chat?.querySelector(`.mes[mesid="${messageId}"]`);
    if (!message) {
        return;
    }
    showForReal([message.previousElementSibling, message, message.nextElementSibling]);
    await preparePictures([message, message.nextElementSibling]);
    settle(chat, () => chat.scrollTop + message.getBoundingClientRect().top - chat.getBoundingClientRect().top);
}

async function scrollToTop() {
    // Older messages that aren't drawn yet are loaded first
    await jumpTo(0);
    settleAtEnd(true);
}

function scrollToBottom() {
    settleAtEnd(false);
}

/**
 * The message being read: the one at the top edge of the chat (the first one that reaches
 * below it), and whether its top is scrolled out of sight.
 */
function messageInView(chat) {
    const top = chat.getBoundingClientRect().top;
    const messages = [...chat.querySelectorAll(':scope > .mes[mesid]')].filter(element => element.offsetParent);
    // Some room either way: themes let messages overlap by a pixel or two, and the one just
    // passed must not count as the one being read
    const index = messages.findIndex(element => element.getBoundingClientRect().bottom > top + 12);
    return index === -1 ? null : { messages, index, cut: messages[index].getBoundingClientRect().top < top - 12 };
}

// Messages drawn in full for a moment (see showForReal), and when to let them go again
const forced = new Set();
let releaseTimer = null;

/**
 * Chat virtualizers (Performance Optimizer and the like) skip drawing messages out of sight
 * (`content-visibility: auto`), giving them a made-up height until they come near. Measured
 * then, they are in the wrong place, so a jump lands somewhere else. These messages are drawn
 * in full for a moment before measuring; let go afterwards, they keep their real size.
 */
export function showForReal(elements) {
    for (const element of elements) {
        if (element && !forced.has(element) && getComputedStyle(element).contentVisibility === 'auto') {
            element.style.contentVisibility = 'visible';
            forced.add(element);
        }
    }
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        forced.forEach(element => element.style.removeProperty('content-visibility'));
        forced.clear();
    }, 3000);
}

/**
 * Puts a drawn message's top edge at the top of the chat in one go, once its pictures are in.
 * Messages that change size after it (chat virtualizers shrink the ones out of sight) are left to
 * the browser's scroll anchoring, which keeps the message in place without a visible jump;
 * aligning again every frame would fight it. One check a moment later puts it right if it still
 * drifted.
 */
async function alignMessage(chat, message) {
    const run = ++settling;
    await preparePictures([message, message.nextElementSibling]);
    // A newer move, or the user scrolling meanwhile, takes over
    if (run !== settling) {
        return;
    }
    const align = () => chat.scrollTo({ top: chat.scrollTop + message.getBoundingClientRect().top - chat.getBoundingClientRect().top, behavior: 'instant' });
    align();
    const spot = spotOf(chat);
    setTimeout(() => {
        // Not after the user started scrolling: that would pull the chat back
        if (run === settling && !scrolledByHand(chat, spot) && Math.abs(message.getBoundingClientRect().top - chat.getBoundingClientRect().top) > 2) {
            align();
        }
    }, 250);
}

/**
 * One message up or down from the one being read, its top edge at the top of the chat. Up from
 * the middle of a long message goes to that message's own start first. Up from the first one
 * drawn loads the older ones (like 번호로 이동).
 */
async function stepMessage(direction) {
    const chat = document.getElementById('chat');
    const first = chat && messageInView(chat);
    if (!first) {
        toastr.info('메시지 없음', TITLE);
        return;
    }
    // The messages around the spot drawn for real, then the spot found again on real sizes
    showForReal(first.messages.slice(Math.max(0, first.index - 2), first.index + 3));
    const { messages, index, cut } = messageInView(chat);
    if (direction < 0) {
        if (cut) {
            alignMessage(chat, messages[index]);
            return;
        }
        if (index > 0) {
            alignMessage(chat, messages[index - 1]);
            return;
        }
        const id = Number(messages[0].getAttribute('mesid'));
        if (id > 0) {
            await jumpTo(id - 1);
            settleAtMessage(id - 1);
        }
        return;
    }
    if (index < messages.length - 1) {
        alignMessage(chat, messages[index + 1]);
    } else {
        scrollToBottom();
    }
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
        // ST's deleteLastMessage leaves the chat file as it was: saved now, so it stays deleted
        await context.saveChat();
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
    // Held in place while messages above are still growing
    settleAtMessage(number);
    // The message flashes as with /chat-jump, to find it at a glance
    const message = document.querySelector(`#chat .mes[mesid="${number}"]`);
    message && flashHighlight($(message), 2000);
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
            <span>{{char}} ⇄ {{user}} 서로 바꾸기</span>
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
    up: () => stepMessage(-1),
    jump: askAndJump,
    down: () => stepMessage(1),
    bottom: scrollToBottom,
    hideRange: askAndHideRange,
};

function runAction(key) {
    Promise.resolve()
        .then(() => (key.startsWith('menu:') ? runMenuItem(key)
            : key.startsWith('link:') ? openExtensionLink(key.slice(5)) : ACTIONS[key]?.()))
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
    const back = open && (vertical ? y > window.innerHeight / 2 : x > window.innerWidth / 2);
    panel.classList.toggle('stqa_grow_back', back);
    // A row longer than the window scrolls; it starts at the ··· end, the buttons nearest to it in sight
    panel.scrollLeft = back && !vertical ? panel.scrollWidth : 0;
    panel.scrollTop = back && vertical ? panel.scrollHeight : 0;
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
            // Let go: it stays where it was dropped (kept inside the window)
            const box = panel.getBoundingClientRect();
            place(box.left, box.top);
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
        // Only ··· picks the panel up: the buttons' row can be scrolled when it is long
        press.timer = setTimeout(() => {
            if (press && !press.moved && !inInputBar() && press.button?.dataset.key === 'toggle') {
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

/** A shortcut button (a menu item's icon may be in any Font Awesome style, so its classes go as they are). */
function createButton(key, icon, label, letter = '') {
    const button = document.createElement('div');
    if (letter) {
        // No icon of its own (an extension's settings): the first letter of its name
        button.className = 'stqa_floating_button stqa_link_letter';
        button.textContent = letter;
    } else {
        button.className = `stqa_floating_button ${/\bfa-(solid|regular|brands|light|thin|duotone)\b|\bfa[srb]\b/.test(icon) ? icon : `fa-solid ${icon}`}`;
    }
    button.dataset.key = key;
    button.title = label;
    return button;
}

function build() {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    const toggle = document.createElement('div');
    toggle.className = 'stqa_floating_button stqa_floating_toggle fa-solid fa-ellipsis';
    toggle.dataset.key = 'toggle';
    toggle.title = '바로가기 펼치기/접기 (꾹 누른 채 끌면 위치 이동)';
    panel.append(toggle);
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
    const ordered = orderedFloatingButtons();
    // Menu items taken off the list go
    for (const button of panel.querySelectorAll(':scope > [data-key^="menu:"], :scope > [data-key^="link:"]')) {
        ordered.some(({ key }) => key === button.dataset.key) || button.remove();
    }
    for (const { key, icon, label, letter } of ordered) {
        const button = [...panel.children].find(child => child.dataset.key === key) ?? createButton(key, icon, label, letter);
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
