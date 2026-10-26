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
    /[^,，、;；]+[,，、;；]*/g, // clauses
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

// Parts a translation keeps unchanged: tags, numbers, Latin words, quote marks, list markers,
// and the tone of a sentence (? ! …)
const KEPT_TOKEN = /<\/?[\w-]+|\d+|[A-Za-z][\w-]+|["“”「」『』*`[\]]|^\s*[-•]|[?？]|[!！]|…|\.\.\./g;
// Translations often switch quote marks (「」 -> "") and full-width marks
const SAME_TOKEN = { '？': '?', '！': '!', '...': '…', '“': '"', '”': '"', '「': '"', '」': '"', '『': '"', '』': '"' };
// What kind of line a piece is: dialogue, a tag / bracket line, a list item, or narration.
// Translators keep this, so pairing different kinds is costly.
const PIECE_KIND = [[/^\s*["“”「」『』]/, 'quote'], [/^\s*[<[]/, 'tag'], [/^\s*[-•*]\s/, 'list']];
const KIND_MISMATCH_COST = 1.5;

function kindOf(text) {
    return PIECE_KIND.find(([pattern]) => pattern.test(text))?.[1] ?? 'text';
}

/**
 * How one unit of meaning can be split on each side: [from pieces, to pieces, extra cost].
 * Translations often merge two sentences into one or split one into two; a piece may also exist
 * on one side only (e.g. a translator's note).
 */
const BEADS = Object.freeze([[1, 1, 0], [2, 1, 0.6], [1, 2, 0.6], [3, 1, 1.4], [1, 3, 1.4], [1, 0, 0.8], [0, 1, 0.8]]);
// Dropping a long piece is unlikely, so a one-sided piece also costs by its length share
const ONE_SIDED_COST_PER_SHARE = 6;
const TOKEN_WEIGHT = 1.2;

// Pieces pair up near the "diagonal" (the n-th paragraph with about the n-th), so only that band
// is searched; the whole table is the fallback when the band finds no path
const BAND_SHARE = 0.25;
const BAND_MIN = 8;

function describePieces(text, pieces) {
    const texts = pieces.map(piece => text.slice(piece.start, piece.end));
    const total = texts.reduce((sum, piece) => sum + piece.length, 0) || 1;
    return texts.map(piece => ({
        share: piece.length / total,
        kind: kindOf(piece),
        tokens: new Set((piece.match(KEPT_TOKEN) ?? []).map(token => SAME_TOKEN[token] ?? token)),
    }));
}

function sharesOf(pieces, start, count) {
    let sum = 0;
    for (let index = start; index < start + count; index++) {
        sum += pieces[index].share;
    }
    return sum;
}

function tokensOf(pieces, start, count) {
    if (count === 1) {
        return pieces[start].tokens;
    }
    const tokens = new Set();
    for (let index = start; index < start + count; index++) {
        pieces[index].tokens.forEach(token => tokens.add(token));
    }
    return tokens;
}

/** Cost of treating a[i..i+di) and b[j..j+dj) as the same unit: different length shares, kinds and kept parts. */
function groupCost(a, i, di, b, j, dj) {
    let cost = Math.log(Math.max(sharesOf(a, i, di), 1e-4) / Math.max(sharesOf(b, j, dj), 1e-4)) ** 2;
    // A merged unit is judged by its first piece's kind
    if (a[i].kind !== b[j].kind) {
        cost += KIND_MISMATCH_COST;
    }
    const tokensA = tokensOf(a, i, di);
    const tokensB = tokensOf(b, j, dj);
    // Kept parts only tell something when both sides have some (an English sentence has words,
    // its Korean translation may have none)
    if (tokensA.size > 0 && tokensB.size > 0) {
        let shared = 0;
        tokensA.forEach(token => tokensB.has(token) && shared++);
        const union = tokensA.size + tokensB.size - shared;
        cost += TOKEN_WEIGHT * (1 - shared / union) * (di + dj) / 2;
    }
    return cost;
}

function alignWithin(a, b, band) {
    const best = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1).fill(Infinity));
    const step = Array.from({ length: a.length + 1 }, () => new Int8Array(b.length + 1).fill(-1));
    best[0][0] = 0;
    const slope = b.length / Math.max(a.length, 1);
    for (let i = 0; i <= a.length; i++) {
        const from = Math.max(0, Math.floor(i * slope - band));
        const to = Math.min(b.length, Math.ceil(i * slope + band));
        for (let j = from; j <= to; j++) {
            if (best[i][j] === Infinity) {
                continue;
            }
            for (let index = 0; index < BEADS.length; index++) {
                const [di, dj, extra] = BEADS[index];
                if (i + di > a.length || j + dj > b.length) {
                    continue;
                }
                const cost = di && dj
                    ? groupCost(a, i, di, b, j, dj)
                    : ONE_SIDED_COST_PER_SHARE * (sharesOf(a, i, di) + sharesOf(b, j, dj));
                const total = best[i][j] + extra + cost;
                if (total < best[i + di][j + dj]) {
                    best[i + di][j + dj] = total;
                    step[i + di][j + dj] = index;
                }
            }
        }
    }
    return best[a.length][b.length] === Infinity ? null : step;
}

/**
 * Aligns the pieces of two versions with the lowest total cost (like aligning a book with its
 * translation sentence by sentence).
 * @returns {{ from: number[], to: number[] }[]} units in order, each with the pieces it covers
 */
function alignPieces(fromText, fromPieces, toText, toPieces) {
    const a = describePieces(fromText, fromPieces);
    const b = describePieces(toText, toPieces);
    const size = Math.max(a.length, b.length);
    const step = alignWithin(a, b, Math.max(BAND_MIN, Math.ceil(size * BAND_SHARE), Math.abs(a.length - b.length) + 2))
        ?? alignWithin(a, b, size);
    const units = [];
    for (let i = a.length, j = b.length; i > 0 || j > 0;) {
        const [di, dj] = BEADS[step[i][j]];
        units.unshift({ from: indexes(i - di, i), to: indexes(j - dj, j) });
        i -= di;
        j -= dj;
    }
    return units;
}

function indexes(start, end) {
    return Array.from({ length: end - start }, (_, index) => start + index);
}

const TAG_BLOCK = /<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/g;

const paragraphCount = text => text.split('\n').filter(line => line.trim()).length;

/**
 * Blanks out tag blocks the other version doesn't have at all (e.g. a <thinking> or <hud> block
 * the translator left out), keeping every offset in place, so they don't throw off the alignment.
 * A block is only left out when that brings the paragraph counts closer: a fold wrapping the
 * whole story (<details>) whose tags the translator dropped must stay.
 */
function maskOneSidedBlocks(text, other) {
    const target = paragraphCount(other);
    let masked = text;
    for (const match of text.matchAll(TAG_BLOCK)) {
        if (new RegExp(`<${match[1]}\\b`, 'i').test(other)) {
            continue;
        }
        const candidate = masked.slice(0, match.index) + match[0].replace(/[^\n]/g, ' ') + masked.slice(match.index + match[0].length);
        if (Math.abs(paragraphCount(candidate) - target) < Math.abs(paragraphCount(masked) - target)) {
            masked = candidate;
        }
    }
    return masked;
}

/**
 * Maps a range in one version of a message (e.g. the translation) to the matching part of
 * another version (the original), going finer level by level (paragraphs, quoted parts,
 * sentences). At each level the pieces are aligned even when the versions split them
 * differently; when the selection only covers pieces the other side lacks, the last match is
 * kept (worst case the whole text).
 * @returns {{ start: number, end: number }}
 */
export function mapToMatchingPart(fromSource, range, toSource) {
    const fromText = maskOneSidedBlocks(fromSource, toSource);
    const toText = maskOneSidedBlocks(toSource, fromSource);
    let fromSpan = { start: 0, end: fromText.length };
    let toSpan = { start: 0, end: toText.length };
    // The selected units of the finest level reached: [from span, to span] of the first and last
    let edgeUnits = null;
    for (const pattern of SEGMENT_LEVELS) {
        const fromPieces = segmentsOf(fromText, fromSpan, pattern);
        const toPieces = segmentsOf(toText, toSpan, pattern);
        const first = fromPieces.findIndex(piece => piece.end > range.start);
        const last = fromPieces.findLastIndex(piece => piece.start < range.end);
        if (first === -1 || last === -1 || first > last || toPieces.length === 0) {
            break;
        }
        const aligned = alignPieces(fromText, fromPieces, toText, toPieces);
        const units = aligned.filter(unit => unit.from.some(index => index >= first && index <= last));
        let matched = units.flatMap(unit => unit.to);
        if (matched.length === 0) {
            // Only pieces the other side lacks were selected: look between the matched neighbours
            const before = aligned.slice(0, aligned.indexOf(units[0])).flatMap(unit => unit.to);
            const after = aligned.slice(aligned.indexOf(units.at(-1)) + 1).flatMap(unit => unit.to);
            const low = before.length > 0 ? Math.max(...before) + 1 : 0;
            const high = after.length > 0 ? Math.min(...after) - 1 : toPieces.length - 1;
            matched = high >= low && high - low < 2 ? indexes(low, high + 1) : [];
        }
        if (matched.length === 0) {
            break;
        }
        // A unit may cover more pieces than were selected (two sentences merged into one)
        const covered = units.flatMap(unit => unit.from);
        fromSpan = { start: fromPieces[Math.min(...covered)].start, end: fromPieces[Math.max(...covered)].end };
        toSpan = { start: toPieces[Math.min(...matched)].start, end: toPieces[Math.max(...matched)].end };
        const spanOf = (pieces, list) => ({ start: pieces[Math.min(...list)].start, end: pieces[Math.max(...list)].end });
        const paired = units.filter(unit => unit.to.length > 0);
        edgeUnits = paired.length === 0 ? null : [paired[0], paired.at(-1)].map(unit => [spanOf(fromPieces, unit.from), spanOf(toPieces, unit.to)]);
    }
    return edgeUnits ? narrowToSelectedPart(fromSource, range, toSource, toSpan, edgeUnits) : toSpan;
}

// Letters and digits: what the proportional step counts (spaces and punctuation differ by language)
const CONTENT_CHAR = /[\p{L}\p{N}]/u;

function charClass(char) {
    if (/\s/.test(char)) {
        return 'space';
    }
    if (/\p{Script=Hiragana}/u.test(char)) {
        return 'hiragana';
    }
    if (/[\p{Script=Katakana}ー]/u.test(char)) {
        return 'katakana';
    }
    if (/\p{Script=Han}/u.test(char)) {
        return 'kanji';
    }
    return CONTENT_CHAR.test(char) || /['’-]/.test(char) ? 'word' : 'mark';
}

/**
 * Where a word may start or end: at spaces and punctuation, and in Japanese (no spaces) where
 * kanji / katakana begins after other characters (words often start that way, particles and
 * endings in hiragana stay attached).
 */
function isWordEdge(text, position, span) {
    if (position <= span.start || position >= span.end) {
        return true;
    }
    const before = charClass(text[position - 1]);
    const after = charClass(text[position]);
    if (before === after) {
        return false;
    }
    return ['space', 'mark'].includes(before) || ['space', 'mark'].includes(after) || after !== 'hiragana';
}

// Japanese has no spaces and kana runs can hold several words, so a step stops after this many
const MAX_CJK_STEP = 3;

/**
 * The next word edge from `position` in `direction` (1 or -1), passing at least one letter, for
 * adjusting a range word by word.
 */
export function nextWordEdge(text, position, direction) {
    const span = { start: 0, end: text.length };
    let letters = 0;
    let cjk = 0;
    let point = position;
    while (point + direction >= 0 && point + direction <= text.length) {
        const char = text[direction > 0 ? point : point - 1];
        letters += CONTENT_CHAR.test(char) ? 1 : 0;
        cjk += ['hiragana', 'katakana', 'kanji'].includes(charClass(char)) ? 1 : 0;
        point += direction;
        if (letters > 0 && (isWordEdge(text, point, span) || cjk >= MAX_CJK_STEP)) {
            break;
        }
    }
    return point;
}

/** `side` says which way a tie goes: toward the end of the text for a start, the other way for an end. */
function nearestWordEdge(text, position, span, side) {
    for (let distance = 0; distance <= span.end - span.start; distance++) {
        // Ties go inward: picking a word too many reads worse than one too few
        const candidates = side === 'start' ? [position + distance, position - distance] : [position - distance, position + distance];
        for (const candidate of candidates) {
            if (candidate >= span.start && candidate <= span.end && isWordEdge(text, candidate, span)) {
                return candidate;
            }
        }
    }
    return position;
}

function lettersOf(text, { start, end }) {
    const positions = [];
    for (let index = start; index < end; index++) {
        if (CONTENT_CHAR.test(text[index])) {
            positions.push(index);
        }
    }
    return positions;
}

/**
 * The point in `toUnit` that sits as far into it as `position` sits into `fromUnit`, counted in
 * letters (spaces and punctuation differ by language), moved to the nearest word edge.
 */
function matchingPoint(fromText, fromUnit, position, toText, toUnit, side) {
    const fromLetters = lettersOf(fromText, fromUnit);
    const toLetters = lettersOf(toText, toUnit);
    const before = fromLetters.filter(index => index < position).length;
    if (before === 0 || toLetters.length === 0) {
        return side === 'start' ? toUnit.start : null;
    }
    if (before === fromLetters.length) {
        return side === 'end' ? toUnit.end : null;
    }
    // Letter counts per word differ between languages, so the estimate is off by a letter or so:
    // the end is rounded down (a word too few is easier to fix than a word too many)
    const share = before / fromLetters.length * toLetters.length;
    const point = side === 'start'
        ? toLetters[Math.min(Math.round(share), toLetters.length - 1)]
        : toLetters[Math.max(Math.floor(share), 1) - 1] + 1;
    return nearestWordEdge(toText, point, toUnit, side);
}

/** Drops spaces and punctuation at the edges that the selection itself doesn't have. */
function trimEdges(text, { start, end }, selected) {
    const isLoose = char => ['space', 'mark'].includes(charClass(char));
    if (!isLoose(selected.at(0) ?? '')) {
        while (start < end && isLoose(text[start])) {
            start++;
        }
    }
    if (!isLoose(selected.at(-1) ?? '')) {
        while (end > start && isLoose(text[end - 1])) {
            end--;
        }
    }
    return { start, end };
}

/**
 * Whether a unit is written mostly in Latin letters (English etc.): its word order is far from
 * Korean, so a part of a sentence can't be placed by position, only the whole sentence / clause.
 */
function isLatinText(text, span) {
    const letters = lettersOf(text, span).map(index => text[index]);
    return letters.filter(char => /[A-Za-zÀ-ɏ]/.test(char)).length > letters.length / 2;
}

/**
 * When only part of the matched units is selected, picks the same part of the other version:
 * the start is placed within the first unit and the end within the last one, each at the same
 * share of letters, then moved to a word edge. Languages with a similar word order (Korean /
 * Japanese) line up well this way; units in English keep their whole length.
 */
function narrowToSelectedPart(fromText, range, toText, toSpan, [[fromFirst, toFirst], [fromLast, toLast]]) {
    const start = isLatinText(toText, toFirst)
        ? toFirst.start
        : matchingPoint(fromText, fromFirst, range.start, toText, toFirst, 'start') ?? toFirst.end;
    const end = isLatinText(toText, toLast)
        ? toLast.end
        : matchingPoint(fromText, fromLast, range.end, toText, toLast, 'end') ?? toLast.start;
    if (end <= start) {
        return toSpan;
    }
    const trimmed = trimEdges(toText, { start, end }, fromText.slice(range.start, range.end).trim());
    return trimmed.end > trimmed.start ? trimmed : { start, end };
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
