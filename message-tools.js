// Buttons on each message:
//  - a row at the bottom left of the message: previous / next reply (the swipe arrows as
//    plain buttons; "next" on the newest reply generates a new one) and "to the top of it"
//  - in the message menu: "to the bottom of this message"
// ST clones #message_template for every new message, so patching the template covers all
// future messages; already-rendered messages are patched once. Which buttons show is set by
// classes on <body>, so switching them costs nothing per message.
import { MODULE, getSettings } from './settings.js';

const FOOTER_CLASS = 'stqa_mes_footer';
const TO_BOTTOM_CLASS = 'stqa_mes_to_bottom';
const FOOTER_BUTTONS = Object.freeze([
    { action: 'prev', icon: 'fa-chevron-left', title: '이전 답변', swipe: true },
    { action: 'next', icon: 'fa-chevron-right', title: '다음 답변 (마지막이면 새로 생성)', swipe: true },
    { action: 'top', icon: 'fa-arrow-up', title: '이 메시지 맨 위로' },
]);

function injectFooter(block) {
    if (block.querySelector(`:scope > .${FOOTER_CLASS}`)) {
        return;
    }
    const footer = document.createElement('div');
    footer.className = FOOTER_CLASS;
    for (const { action, icon, title, swipe } of FOOTER_BUTTONS) {
        const button = document.createElement('div');
        button.className = `stqa_footer_button fa-solid ${icon}${swipe ? ' stqa_footer_swipe' : ''}`;
        button.dataset.stqaAction = action;
        button.title = title;
        footer.append(button);
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

/** Scrolls the chat so the message's top (or bottom) edge is in view. */
function scrollToMessageEdge(message, edge) {
    message.scrollIntoView({ block: edge === 'top' ? 'start' : 'end', behavior: 'smooth' });
}

/** Runs ST's own swipe through its arrow on that message, so all its rules and events apply. */
function swipe(message, direction) {
    const arrow = message.querySelector(direction === 'prev' ? '.swipe_left' : '.swipe_right');
    if (!arrow) {
        toastr.info('이 메시지는 다른 답변으로 넘길 수 없어요.', '편의성 모음');
        return;
    }
    arrow.click();
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
            swipe(message, action);
        } else {
            scrollToMessageEdge(message, action);
        }
    } catch (error) {
        console.error(`[${MODULE}] Message button failed`, error);
    }
}

export function applyMessageToolSettings() {
    const settings = getSettings();
    document.body.classList.toggle('stqa_footer_swipe_on', settings.footerSwipe);
    document.body.classList.toggle('stqa_footer_top_on', settings.footerTop);
    document.body.classList.toggle('stqa_to_bottom_on', settings.menuToBottom);
}

export function initMessageTools() {
    patchMessages();
    applyMessageToolSettings();
    document.getElementById('chat')?.addEventListener('click', onChatClick);
}
