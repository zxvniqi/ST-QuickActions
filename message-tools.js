// Buttons on each message:
//  - a row under the message (left, middle or right, as set): previous / next reply (the swipe arrows as
//    plain buttons; "next" on the newest reply generates a new one) and "to the top of it"
//  - in the message menu: "to the bottom of this message"
// ST clones #message_template for every new message, so patching the template covers all
// future messages; already-rendered messages are patched once. Which buttons show is set by
// classes on <body>, so switching them costs nothing per message.
import { MODULE, getSettings, isOn } from './settings.js';

/** Where ‹ 1/3 › and ↑ sit under the message. */
export const FOOTER_POSITIONS = Object.freeze([
    { value: 'left', label: '위치: 왼쪽' },
    { value: 'center', label: '위치: 가운데' },
    { value: 'right', label: '위치: 오른쪽' },
]);

const FOOTER_CLASS = 'stqa_mes_footer';
const TO_BOTTOM_CLASS = 'stqa_mes_to_bottom';
const FOOTER_BUTTONS = Object.freeze([
    { action: 'prev', icon: 'fa-chevron-left', title: '이전 답변', swipe: true },
    { action: 'count', title: '답변 번호', swipe: true },
    { action: 'next', icon: 'fa-chevron-right', title: '다음 답변 (마지막이면 새로 생성)', swipe: true },
    { action: 'top', icon: 'fa-arrow-up', title: '이 메시지 맨 위로' },
]);

function injectFooter(block) {
    if (block.querySelector(`:scope > .${FOOTER_CLASS}`)) {
        return;
    }
    const footer = document.createElement('div');
    footer.className = FOOTER_CLASS;
    // ‹ 1/3 › sit in one box
    const swipes = document.createElement('div');
    swipes.className = 'stqa_footer_swipe';
    footer.append(swipes);
    for (const { action, icon, title, swipe } of FOOTER_BUTTONS) {
        const button = document.createElement('div');
        button.className = action === 'count' ? 'stqa_footer_count' : `stqa_footer_button fa-solid ${icon}`;
        button.dataset.stqaAction = action;
        button.title = title;
        (swipe ? swipes : footer).append(button);
    }
    block.append(footer);
}

function injectToBottom(box) {
    if (box.querySelector(`.${TO_BOTTOM_CLASS}`)) {
        return;
    }
    const button = document.createElement('div');
    button.className = `mes_button ${TO_BOTTOM_CLASS} fa-solid fa-arrow-down`;
    button.title = '이 메시지 맨 아래로';
    box.append(button);
}

function patchMessages(root = document) {
    root.querySelectorAll('#message_template .mes_block, #chat .mes .mes_block').forEach(injectFooter);
    root.querySelectorAll('#message_template .extraMesButtons, #chat .mes .extraMesButtons').forEach(injectToBottom);
}

/**
 * Scrolls the chat (only the chat: scrollIntoView would also move the page and push the top
 * bar out of view) so the message's top or bottom edge is at the edge of the chat.
 */
function scrollToMessageEdge(message, edge) {
    const chat = document.getElementById('chat');
    const box = message.getBoundingClientRect();
    const view = chat.getBoundingClientRect();
    const offset = edge === 'top' ? box.top - view.top : box.bottom - view.bottom;
    chat.scrollBy({ top: offset, behavior: 'smooth' });
}

/**
 * ST's own swipe, so all its rules and events apply. Started as from a slash command: that
 * works even with ST's swipe arrows / gestures switched off (the point of these buttons).
 */
async function swipe(message, direction) {
    const context = SillyTavern.getContext();
    const target = context.chat[Number(message.getAttribute('mesid'))];
    const to = context.swipe?.to;
    if (typeof to === 'function') {
        await to(null, direction === 'prev' ? 'left' : 'right', { source: 'slash_command', message: target });
        return;
    }
    message.querySelector(direction === 'prev' ? '.swipe_left' : '.swipe_right')?.click();
}

/** "2/3" between the arrows, for the newest reply (the only one the arrows show on). */
function updateCount() {
    const { chat } = SillyTavern.getContext();
    const last = chat.length - 1;
    const message = chat[last];
    const count = document.querySelector(`#chat .mes[mesid="${last}"] .stqa_footer_count`);
    if (count && message) {
        const total = Math.max(1, message.swipes?.length ?? 1);
        count.textContent = `${Math.min((message.swipe_id ?? 0) + 1, total)}/${total}`;
    }
}

/**
 * Whether › may make a new version here. On its last version ST would write a normal reply in its
 * place, which a note (/comment, /sys: ST itself never swipes those) must never get. Notes a QR
 * made are made again by the QR instead (qr-input), before this is reached.
 */
function canMakeNew(element) {
    const { chat } = SillyTavern.getContext();
    const message = chat[Number(element.getAttribute('mesid'))];
    if (message?.extra?.stqa_qr && isOn('qrSwipe')) {
        return true;
    }
    const onLast = (message?.swipe_id ?? 0) >= (message?.swipes?.length ?? 1) - 1;
    const note = message?.extra?.isSmallSys || ['comment', 'narrator'].includes(message?.extra?.type);
    return !onLast || !(note || message?.extra?.swipeable === false || message?.is_user);
}

function onChatClick(event) {
    const button = event.target.closest(`.${FOOTER_CLASS} [data-stqa-action], .${TO_BOTTOM_CLASS}`);
    const message = button?.closest('.mes');
    if (!message) {
        return;
    }
    const action = button.classList.contains(TO_BOTTOM_CLASS) ? 'bottom' : button.dataset.stqaAction;
    try {
        if (action === 'prev' || action === 'next') {
            if (action === 'next' && !canMakeNew(message)) {
                toastr.info('노트 메시지는 새로 생성할 수 없습니다.', '편의성 모음');
                return;
            }
            swipe(message, action).catch(error => console.error(`[${MODULE}] Swipe failed`, error));
        } else if (action !== 'count') {
            scrollToMessageEdge(message, action);
        }
    } catch (error) {
        console.error(`[${MODULE}] Message button failed`, error);
    }
}

export function applyMessageToolSettings() {
    const settings = getSettings();
    document.body.classList.toggle('stqa_footer_swipe_on', isOn('footerSwipe'));
    document.body.classList.toggle('stqa_footer_top_on', isOn('footerTop'));
    for (const [name, value] of [['swipe', settings.footerSwipePos], ['top', settings.footerTopPos]]) {
        const position = FOOTER_POSITIONS.some(option => option.value === value) ? value : 'left';
        FOOTER_POSITIONS.forEach(option => document.body.classList.toggle(`stqa_${name}_at_${option.value}`, option.value === position));
    }
    document.body.classList.toggle('stqa_to_bottom_on', isOn('menuToBottom'));
    updateCount();
}

export function initMessageTools() {
    patchMessages();
    applyMessageToolSettings();
    const chat = document.getElementById('chat');
    chat?.addEventListener('click', onChatClick);
    // ST's own arrow (and swipe gesture, which taps it) on a note's last version: no normal reply there
    document.addEventListener('click', (event) => {
        const arrow = event.target.closest?.('#chat .swipe_right');
        const message = arrow?.closest('.mes');
        if (message && !canMakeNew(message)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            toastr.info('노트 메시지는 새로 생성할 수 없습니다.', '편의성 모음');
        }
    }, true);
    // The number is filled in as soon as messages are drawn (chat opened, more loaded, a reply
    // added), not after: only the chat's own children are watched, so streaming text costs nothing
    if (chat) {
        new MutationObserver(updateCount).observe(chat, { childList: true });
    }
    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const event of [eventTypes.MESSAGE_SWIPED, eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_DELETED]) {
        eventSource.on(event, updateCount);
    }
}
