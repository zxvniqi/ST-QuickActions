// Keeps status panels drawn. Panels made by Tavern Helper (an HTML code block turned into a
// frame) are drawn when a message is shown or edited; a translation (or reload) that redraws the
// message text without telling anyone leaves the raw code on screen. Such messages are drawn
// again (as after an edit), keeping the translation.
import { MODULE, getSettings } from './settings.js';

const CHECK_DELAY_MS = 600;
// Code the frame renderer would have turned into a panel
const PANEL_CODE = /<(?:!DOCTYPE|html|body)\b/i;

// Messages already redrawn for their current text (a panel that still won't draw is left alone)
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
    if (redrawn.get(messageId) === shown) {
        return;
    }
    const remembered = message.extra?.original_text_for_translation;
    if (message.extra?.display_text && remembered && remembered !== context.substituteParams(message.mes, context.name1, message.name)) {
        return;
    }
    redrawn.set(messageId, shown);
    context.updateMessageBlock(messageId, message);
    await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
}

function check() {
    timer = null;
    if (!getSettings().keepStatusPanels || !renderer()) {
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
    const chat = document.getElementById('chat');
    if (chat) {
        // Any redraw of messages (translation shown or hidden, more messages loaded, ...)
        new MutationObserver(scheduleCheck).observe(chat, { childList: true, subtree: true });
    }
}
