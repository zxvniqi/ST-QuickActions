// Parts of a message that the user's regex scripts hide on screen: a block removed outright
// (e.g. <thinking>) or turned into a card / code block (status panels). They aren't readable
// text, so matching and searching should ignore them. Uses SillyTavern's own regex engine, with
// the same rules it applies when drawing a message (display-only scripts, depth, allowed scopes).

let engine = null;
try {
    const [regex, utils] = await Promise.all([import('../../regex/engine.js'), import('../../../utils.js')]);
    engine = { getRegexScripts: regex.getRegexScripts, regexFromString: utils.regexFromString };
} catch (error) {
    console.warn('[st_quick_actions] Regex engine not available; hidden parts are not skipped', error);
}

const AI_OUTPUT = 2;
const USER_INPUT = 1;
// Replacements that leave no readable text: nothing, or a card / code block
const HIDING_REPLACEMENT = /^\s*(?:$|```|<!DOCTYPE|<html|<style|<script)/i;

function appliesAt(script, depth) {
    const below = Number.isFinite(script.minDepth) && script.minDepth >= -1 && depth < script.minDepth;
    const above = Number.isFinite(script.maxDepth) && script.maxDepth >= 0 && depth > script.maxDepth;
    return !below && !above;
}

/**
 * Ranges of `text` that the display regex scripts hide for this message.
 * @param {{ isUser: boolean, depth: number }} message
 * @returns {{ start: number, end: number }[]}
 */
export function hiddenRanges(text, { isUser, depth }) {
    const { extensionSettings } = SillyTavern.getContext();
    if (!engine || !text || extensionSettings.disabledExtensions?.includes('regex')) {
        return [];
    }
    const placement = isUser ? USER_INPUT : AI_OUTPUT;
    const ranges = [];
    for (const script of engine.getRegexScripts({ allowedOnly: true })) {
        if (script.disabled || !script.markdownOnly || !script.placement?.includes(placement)
            || !HIDING_REPLACEMENT.test(script.replaceString ?? '') || !appliesAt(script, depth)) {
            continue;
        }
        const regex = engine.regexFromString(script.findRegex ?? '');
        if (!regex) {
            continue;
        }
        const global = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
        for (const match of text.matchAll(global)) {
            if (match[0]) {
                ranges.push({ start: match.index, end: match.index + match[0].length });
            }
            // A non-global script only replaces its first match
            if (!regex.global) {
                break;
            }
        }
    }
    return ranges;
}

/** The text with its hidden parts blanked out (offsets unchanged, line breaks kept). */
export function maskHidden(text, message) {
    let masked = text;
    for (const { start, end } of hiddenRanges(text, message)) {
        masked = masked.slice(0, start) + masked.slice(start, end).replace(/[^\n]/g, ' ') + masked.slice(end);
    }
    return masked;
}

/** What `hiddenRanges` needs to know about a chat message. */
export function messageInfo(chat, messageId) {
    return { isUser: Boolean(chat[messageId]?.is_user), depth: chat.length - 1 - messageId };
}
