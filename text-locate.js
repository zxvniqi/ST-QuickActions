// Maps text selected on screen back to its position in the raw message source.
// The rendered text lacks markdown markers / HTML tags, so the search tolerates them.

const MARKUP_GAP = '(?:[*_~`]|<[^>]*>)*';
const WRAPPER_CHARS = '*_~';

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countOccurrences(haystack, needle) {
    if (!needle) {
        return 0;
    }
    let count = 0;
    for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) {
        count++;
    }
    return count;
}

function buildLoosePattern(text) {
    const normalized = text.trim().replace(/\s+/g, ' ');
    const parts = [...normalized].map(char => (char === ' ' ? '\\s+' : escapeRegex(char)));
    return new RegExp(parts.join(MARKUP_GAP), 'g');
}

/**
 * @param {string} source Raw message text
 * @param {string} selected Text as selected on screen
 * @param {number} occurrence How many times the selection appears on screen before it (0-based)
 * @returns {{ start: number, end: number }|null}
 */
export function locateInSource(source, selected, occurrence) {
    const exact = [];
    for (let index = source.indexOf(selected); index !== -1; index = source.indexOf(selected, index + 1)) {
        exact.push(index);
    }
    if (exact.length > 0) {
        const start = exact[Math.min(occurrence, exact.length - 1)];
        return { start, end: start + selected.length };
    }

    const matches = [...source.matchAll(buildLoosePattern(selected))];
    if (matches.length === 0) {
        return null;
    }
    const match = matches[Math.min(occurrence, matches.length - 1)];
    return { start: match.index, end: match.index + match[0].length };
}

/**
 * Ways to cut a text into pieces, from coarse to fine. Translations keep this structure
 * (paragraphs, "Name: 「line」" parts, sentences) even when the words differ completely.
 */
const SEGMENT_LEVELS = Object.freeze([
    /[^\n]+/g, // paragraphs
    /[^:：「」『』"“”()（）[\]]+/g, // speaker name / quoted parts
    /[^.。!！?？…]+[.。!！?？…]*/g, // sentences
]);

/** Non-blank pieces of text[span] at one level, as absolute { start, end } (trimmed). */
function segmentsOf(text, span, pattern) {
    const pieces = [];
    const slice = text.slice(span.start, span.end);
    for (const match of slice.matchAll(pattern)) {
        const leading = match[0].length - match[0].trimStart().length;
        const content = match[0].trim();
        if (content) {
            const start = span.start + match.index + leading;
            pieces.push({ start, end: start + content.length });
        }
    }
    return pieces;
}

/**
 * Maps a range in one version of a message (e.g. the translation) to the matching part of
 * another version (the original). Pieces are matched by position, going finer level by level
 * while both versions have the same number of pieces; otherwise the last match is kept
 * (in the worst case the whole other text).
 * @returns {{ start: number, end: number }}
 */
export function mapToMatchingPart(fromText, range, toText) {
    let fromSpan = { start: 0, end: fromText.length };
    let toSpan = { start: 0, end: toText.length };
    for (const pattern of SEGMENT_LEVELS) {
        const fromPieces = segmentsOf(fromText, fromSpan, pattern);
        const toPieces = segmentsOf(toText, toSpan, pattern);
        const first = fromPieces.findIndex(piece => piece.end > range.start);
        const last = fromPieces.findLastIndex(piece => piece.start < range.end);
        if (fromPieces.length !== toPieces.length || first === -1 || last === -1 || first > last) {
            break;
        }
        fromSpan = { start: fromPieces[first].start, end: fromPieces[last].end };
        toSpan = { start: toPieces[first].start, end: toPieces[last].end };
    }
    return toSpan;
}

/** Widens a range over markdown markers that wrap it exactly (e.g. *text*), so deleting leaves no stray markers. */
export function expandOverWrappers(source, { start, end }) {
    while (start > 0 && end < source.length && source[start - 1] === source[end] && WRAPPER_CHARS.includes(source[end])) {
        start--;
        end++;
    }
    return { start, end };
}

const MARKUP_TOKEN = /[*_~`]+|<[^>]*>/g;

/**
 * Joins the two sides of a cut, dropping markup that became an empty pair exactly at the
 * cut (e.g. `**` + `**`, `<i>` + `</i>`) and a doubled space. Nothing else is touched.
 */
function joinAtCut(before, after) {
    for (;;) {
        const markerBefore = before.match(/[*_~]+$/)?.[0];
        if (markerBefore && after.startsWith(markerBefore)) {
            before = before.slice(0, -markerBefore.length);
            after = after.slice(markerBefore.length);
            continue;
        }
        const openTag = before.match(/<(\w+)\b[^>]*>$/);
        if (openTag && after.startsWith(`</${openTag[1]}>`)) {
            before = before.slice(0, -openTag[0].length);
            after = after.slice(openTag[1].length + 3);
            continue;
        }
        break;
    }
    if (/ $/.test(before) && (/^[ \n.,!?]/.test(after) || after === '')) {
        before = before.slice(0, -1);
    }
    return before + after;
}

/** Markup tokens in a slice that have no partner inside it (they pair with text outside). */
function unbalancedMarkup(slice) {
    const stack = [];
    for (const token of slice.match(MARKUP_TOKEN) ?? []) {
        const closeTag = token.match(/^<\/(\w+)/);
        const top = stack[stack.length - 1];
        const closesTop = closeTag ? top?.startsWith(`<${closeTag[1]}`) : top === token && !token.startsWith('<');
        closesTop ? stack.pop() : stack.push(token);
    }
    return stack.join('');
}

/**
 * Removes the text in a range. Markup that pairs with text outside the range is kept, so a
 * selection crossing **bold** or <tag> boundaries doesn't leave unbalanced markup behind.
 */
export function removeRange(source, { start, end }) {
    const keptMarkup = unbalancedMarkup(source.slice(start, end));
    return joinAtCut(source.slice(0, start), keptMarkup + source.slice(end));
}
