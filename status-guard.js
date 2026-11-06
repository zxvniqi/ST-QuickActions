// Keeps status panels drawn. Panels made by Tavern Helper (an HTML code block turned into a
// frame) are drawn when a message is shown or edited; anything that redraws the message text
// without telling (a translation, a reload, a swipe back, another extension) leaves the raw code
// on screen. Such messages are drawn again (as after an edit), keeping the translation.
import { MODULE, isOn } from './settings.js';

const CHECK_DELAY_MS = 600;
// A panel still raw after a redraw is tried again a few times (the renderer may not have been
// ready: a chat reloaded twice in a row, as when Sideleaf puts a message in), then left alone
const MAX_TRIES = 3;
const RETRY_DELAY_MS = 1500;
// Code the frame renderer would have turned into a panel
const PANEL_CODE = /<(?:!DOCTYPE|html|body)\b/i;

// Messages redrawn for their current text: { text, tries }
const redrawn = new Map();
let timer = null;

const renderer = () => typeof window.TavernHelper === 'object' || document.querySelector('#chat .TH-render');

/** Messages showing panel code as plain text. */
function brokenMessages() {
    const ids = new Set();
    for (const code of document.querySelectorAll('#chat .mes_text pre')) {
        if (code.offsetParent !== null && PANEL_CODE.test(code.textContent)) {
            ids.add(Number(code.closest('.mes')?.getAttribute('mesid')));
        }
    }
    return [...ids].filter(Number.isInteger);
}

/**
 * Redraws a message and announces it as edited, which makes the frame renderer draw its panels.
 * Only when the text really is unchanged: the translator drops a translation whose original
 * changed, and that must not happen here.
 */
async function redraw(messageId) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    if (!message) {
        return;
    }
    const shown = message.extra?.display_text ?? message.mes;
    const before = redrawn.get(messageId);
    const tries = before?.text === shown ? before.tries : 0;
    if (tries >= MAX_TRIES) {
        return;
    }
    const remembered = message.extra?.original_text_for_translation;
    if (message.extra?.display_text && remembered && remembered !== context.substituteParams(message.mes, context.name1, message.name)) {
        return;
    }
    redrawn.set(messageId, { text: shown, tries: tries + 1 });
    context.updateMessageBlock(messageId, message);
    await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
    // Looked at again a little later, in case the renderer wasn't ready this time
    if (tries + 1 < MAX_TRIES) {
        setTimeout(scheduleCheck, RETRY_DELAY_MS);
    }
}

function check() {
    timer = null;
    if (!isOn('keepStatusPanels') || !renderer()) {
        return;
    }
    // A reply being written is redrawn by itself when it's done
    const stop = document.getElementById('mes_stop');
    if (stop && getComputedStyle(stop).display !== 'none') {
        scheduleCheck();
        return;
    }
    for (const messageId of brokenMessages()) {
        redraw(messageId).catch(error => console.error(`[${MODULE}] Status panel redraw failed`, error));
    }
}

function scheduleCheck() {
    clearTimeout(timer);
    timer = setTimeout(check, CHECK_DELAY_MS);
}

export function initStatusGuard() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        redrawn.clear();
        scheduleCheck();
    });
    // A reply swiped away and back (or edited) is drawn anew: it may need redrawing again
    for (const event of [eventTypes.MESSAGE_SWIPED, eventTypes.MESSAGE_EDITED, eventTypes.MESSAGE_DELETED]) {
        eventSource.on(event, (messageId) => {
            redrawn.delete(Number(messageId));
            scheduleCheck();
        });
    }
    const chat = document.getElementById('chat');
    if (chat) {
        // Any redraw of messages (translation shown or hidden, more messages loaded, ...). A
        // message drawn anew as a whole (the chat reloaded) gets its tries back.
        new MutationObserver((records) => {
            for (const record of records) {
                if (record.target !== chat) {
                    continue;
                }
                for (const node of record.addedNodes) {
                    node.classList?.contains('mes') && redrawn.delete(Number(node.getAttribute('mesid')));
                }
            }
            scheduleCheck();
        }).observe(chat, { childList: true, subtree: true });
    }
}
