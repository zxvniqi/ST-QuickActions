// Small helpers several features share.

/**
 * A reply being written. ST shows its stop button only then (by its display; a theme that places
 * the button fixed leaves it no offsetParent, so that is not looked at).
 */
export function isGenerating() {
    const stop = document.getElementById('mes_stop');
    return Boolean(stop) && getComputedStyle(stop).display !== 'none';
}

/**
 * A message drawn again announced as updated, so screen renderers (Tavern Helper) draw their
 * panels again. ST's translator takes that for an edit and, in manual mode, drops the
 * translation: the text didn't change here, so it is put back.
 */
export async function announceUpdated(id) {
    const context = SillyTavern.getContext();
    const message = context.chat[id];
    const text = message?.mes;
    const translation = message?.extra?.display_text;
    await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, id);
    if (translation && context.chat[id] === message && message.mes === text && !message.extra?.display_text) {
        message.extra.display_text = translation;
        context.updateMessageBlock(id, message);
        await context.saveChat();
    }
}

/** Text safe to put into HTML. */
export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}
