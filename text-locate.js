// Maps text selected on screen back to its position in the raw message source.
// The rendered text lacks markdown markers / HTML tags, so the search tolerates them.

// Real tags only (a letter after "<"), so emoticons like ( >///< ) stay plain text
const MARKUP_GAP = '(?:[*_~`]|</?[A-Za-z][^<>]*>)*';
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

// Parts a translation keeps unchanged: tags, numbers, Latin words, quote marks, list markers
const KEPT_TOKEN = /<\/?[\w-]+|\d+|[A-Za-z][\w-]+|["“”「」『』*`[\]]|^\s*[-•]/g;

/** How alike two paragraphs of different languages look (0..2): shared kept parts + similar length share. */
function similarity(a, b, lengthShareA, lengthShareB) {
    const tokensA = new Set(a.match(KEPT_TOKEN));
    const tokensB = new Set(b.match(KEPT_TOKEN));
    const union = new Set([...tokensA, ...tokensB]).size;
    const shared = [...tokensA].filter(token => tokensB.has(token)).length;
    const tokenScore = union === 0 ? 0.3 : shared / union;
    return tokenScore + Math.min(lengthShareA, lengthShareB) / Math.max(lengthShareA, lengthShareB);
}

/**
 * Pairs up the paragraphs of two versions when one has extra ones (e.g. translator's notes):
 * the pairing with the highest total similarity, extra paragraphs left unpaired.
 * @returns {number[]} for each `from` piece, the index of its `to` piece or -1
 */
function alignPieces(fromText, fromPieces, toText, toPieces) {
    const texts = (text, pieces) => pieces.map(piece => text.slice(piece.start, piece.end));
    const shares = list => {
        const total = list.reduce((sum, text) => sum + text.length, 0) || 1;
        return list.map(text => text.length / total);
    };
    const fromTexts = texts(fromText, fromPieces);
    const toTexts = texts(toText, toPieces);
    const fromShares = shares(fromTexts);
    const toShares = shares(toTexts);
    const rows = fromTexts.length;
    const cols = toTexts.length;
    // best[i][j]: best total for the first i / j pieces
    const best = Array.from({ length: rows + 1 }, () => new Float64Array(cols + 1));
    for (let i = 1; i <= rows; i++) {
        for (let j = 1; j <= cols; j++) {
            const paired = best[i - 1][j - 1] + similarity(fromTexts[i - 1], toTexts[j - 1], fromShares[i - 1], toShares[j - 1]);
            best[i][j] = Math.max(paired, best[i - 1][j], best[i][j - 1]);
        }
    }
    const result = new Array(rows).fill(-1);
    for (let i = rows, j = cols; i > 0 && j > 0;) {
        if (best[i][j] === best[i - 1][j]) {
            i--;
        } else if (best[i][j] === best[i][j - 1]) {
            j--;
        } else {
            result[--i] = --j;
        }
    }
    return result;
}

/**
 * Maps a range in one version of a message (e.g. the translation) to the matching part of
 * another version (the original). Pieces are matched by position, going finer level by level
 * while both versions have the same number of pieces. Paragraphs are paired by similarity when
 * their numbers differ; finer levels stop there, keeping the last match (worst case the whole text).
 * @returns {{ start: number, end: number }}
 */
export function mapToMatchingPart(fromText, range, toText) {
    let fromSpan = { start: 0, end: fromText.length };
    let toSpan = { start: 0, end: toText.length };
    for (const [level, pattern] of SEGMENT_LEVELS.entries()) {
        const fromPieces = segmentsOf(fromText, fromSpan, pattern);
        const toPieces = segmentsOf(toText, toSpan, pattern);
        const first = fromPieces.findIndex(piece => piece.end > range.start);
        const last = fromPieces.findLastIndex(piece => piece.start < range.end);
        if (first === -1 || last === -1 || first > last) {
            break;
        }
        let toFirst = first;
        let toLast = last;
        if (fromPieces.length !== toPieces.length) {
            if (level > 0) {
                break;
            }
            const paired = alignPieces(fromText, fromPieces, toText, toPieces).slice(first, last + 1).filter(index => index !== -1);
            if (paired.length === 0) {
                break;
            }
            toFirst = Math.min(...paired);
            toLast = Math.max(...paired);
        }
        fromSpan = { start: fromPieces[first].start, end: fromPieces[last].end };
        toSpan = { start: toPieces[toFirst].start, end: toPieces[toLast].end };
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

const MARKUP_TOKEN = /[*_~`]+|<\/?[A-Za-z][^<>]*>/g;

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
