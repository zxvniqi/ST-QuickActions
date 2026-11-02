// Words a translation keeps recognisable: Sino-Korean words written in kanji / hanzi in the
// original (防音 -> 방음), names and loanwords in katakana or Latin letters (ガブリエル / Gabriel
// -> 가브리엘), and numbers. Pairs of such words ("anchors") pin down where a part of a sentence
// sits in the other version.
import { HANJA_READINGS } from './hanja-readings.js';

let readings = null;

function readingOf(char) {
    if (!readings) {
        readings = new Map();
        for (let index = 0; index < HANJA_READINGS.length; index += 2) {
            readings.set(HANJA_READINGS[index], HANJA_READINGS[index + 1]);
        }
    }
    return readings.get(char);
}

// Sounds are compared by consonant only (vowels shift a lot between languages), merged into
// classes: voiced / unvoiced pairs, l / r and m / n count as the same. "C" (ch / ts) matches
// both t and s, as チ is 치 in some words and 티 in others.
const HANGUL_INITIAL = ['K', 'K', 'N', 'T', 'T', 'R', 'N', 'P', 'P', 'S', 'S', '', 'S', 'S', 'C', 'K', 'T', 'P', 'H'];
const HANGUL_FINAL = ['', 'K', 'K', 'K', 'N', 'N', 'N', 'T', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'N', 'P', 'P', 'T', 'T', 'N', 'T', 'C', 'K', 'T', 'P', ''];
const KANA_ROWS = [
    ['カキクケコガギグゲゴヵヶ', 'K'], ['サシスセソザジズゼゾ', 'S'], ['タテトダデド', 'T'], ['チツヂヅ', 'C'],
    ['ナニヌネノンマミムメモ', 'N'], ['ハヒヘホ', 'H'], ['フバビブベボパピプペポヴ', 'P'], ['ラリルレロ', 'R'],
];
const KANA_SOUND = new Map(KANA_ROWS.flatMap(([chars, sound]) => [...chars].map(char => [char, sound])));
const LATIN_SOUNDS = [
    [/ch|tch/y, 'C'], [/sh|ts/y, 'S'], [/th|ck/y, ''], [/ph/y, 'P'], [/gh|ng/y, ''], [/[bpfv]/y, 'P'], [/c(?=[eiy])/y, 'S'],
    [/[cgkq]/y, 'K'], [/[dt]/y, 'T'], [/[sxzj]/y, 'S'], [/[mn]/y, 'N'], [/[lr]/y, 'R'], [/h/y, 'H'],
];

function sameSound(a, b) {
    return a === b || (a === 'C' && 'TS'.includes(b)) || (b === 'C' && 'TS'.includes(a));
}

function sameSkeleton(a, b) {
    return a.length === b.length && [...a].every((sound, index) => sameSound(sound, b[index]));
}

/** Adds sounds to a skeleton, dropping a repeat of the last one (tt, ll). */
function pushSound(skeleton, sound) {
    return sound && skeleton.at(-1) !== sound ? skeleton + sound : skeleton;
}

function hangulSounds(char) {
    const code = char.charCodeAt(0) - 0xAC00;
    return [HANGUL_INITIAL[Math.floor(code / 588)], HANGUL_FINAL[code % 28]];
}

function kanaSkeleton(word) {
    let skeleton = '';
    for (const char of word) {
        skeleton = pushSound(skeleton, KANA_SOUND.get(char) ?? '');
    }
    return skeleton;
}

function latinSkeleton(word) {
    const lower = word.toLowerCase();
    let skeleton = '';
    for (let index = 0; index < lower.length;) {
        const rule = LATIN_SOUNDS.find(([pattern]) => (pattern.lastIndex = index, pattern.test(lower)));
        if (rule) {
            // th / ck count as t / k
            const sound = rule[1] || { th: 'T', ck: 'K' }[lower.slice(index, index + 2)] || '';
            skeleton = pushSound(skeleton, sound);
            index = rule[0].lastIndex;
        } else {
            index++;
        }
    }
    return skeleton;
}

const HANGUL = /[가-힣]+/g;
// Words of the other scripts: kanji / hanzi runs, katakana runs, Latin words, numbers
const MARKED_WORD = /\p{Script=Han}+|[\p{Script=Katakana}ー]{2,}|[A-Za-z][A-Za-z'-]+|\d+/gu;

/** Hangul words of text[span] with their syllables' sounds, for matching against marked words. */
function hangulWords(text, span) {
    const words = [];
    for (const match of text.slice(span.start, span.end).matchAll(HANGUL)) {
        words.push({ start: span.start + match.index, word: match[0] });
    }
    return words;
}

/**
 * Places in hangul `words` that say `marked`: the Korean reading of kanji (two characters or
 * more, part of a run counts), or a name / loanword spelled with the same consonants.
 * @returns {{ markedStart: number, markedEnd: number, start: number, end: number, weight: number }[]}
 */
function soundMatches(marked, words) {
    const found = [];
    if (/\p{Script=Han}/u.test(marked)) {
        const reading = [...marked].map(char => readingOf(char) ?? '?').join('');
        // Longest parts first; a shorter part inside an already matched one adds nothing
        const taken = new Set();
        for (let length = reading.length; length >= 2; length--) {
            for (let from = 0; from + length <= reading.length; from++) {
                const part = reading.slice(from, from + length);
                if (part.includes('?') || [...Array(length).keys()].every(offset => taken.has(from + offset))) {
                    continue;
                }
                for (const { start, word } of words) {
                    for (let at = word.indexOf(part); at !== -1; at = word.indexOf(part, at + 1)) {
                        found.push({ markedStart: from, markedEnd: from + length, start: start + at, end: start + at + length, weight: length });
                        for (let offset = 0; offset < length; offset++) {
                            taken.add(from + offset);
                        }
                    }
                }
            }
        }
        return found;
    }
    if (/^\d+$/.test(marked)) {
        return found;
    }
    const skeleton = /[A-Za-z]/.test(marked) ? latinSkeleton(marked) : kanaSkeleton(marked);
    if (skeleton.length < 2) {
        return found;
    }
    // A name is followed by particles (가브리엘은): the word's first syllables must say it
    for (const { start, word } of words) {
        let sounds = '';
        for (let length = 1; length <= word.length; length++) {
            const [initial, final] = hangulSounds(word[length - 1]);
            sounds = pushSound(pushSound(sounds, initial), final);
            if (sounds.length > skeleton.length + 1) {
                break;
            }
            if (length >= 2 && sameSkeleton(sounds, skeleton)) {
                found.push({ markedStart: 0, markedEnd: marked.length, start, end: start + length, weight: skeleton.length });
            }
        }
    }
    return found;
}

/**
 * Pairs of words that say the same thing in two versions of a text (one side in Korean),
 * in the same order on both sides, as many as fit.
 * @returns {{ from: { start: number, end: number }, to: { start: number, end: number } }[]}
 */
export function findAnchors(fromText, fromSpan, toText, toSpan) {
    const candidates = [];
    const collect = (markedText, markedSpan, hangulText, hangulSpan, markedIsFrom) => {
        const words = hangulWords(hangulText, hangulSpan);
        if (words.length === 0) {
            return;
        }
        for (const match of markedText.slice(markedSpan.start, markedSpan.end).matchAll(MARKED_WORD)) {
            const base = markedSpan.start + match.index;
            for (const found of soundMatches(match[0], words)) {
                const marked = { start: base + found.markedStart, end: base + found.markedEnd };
                const said = { start: found.start, end: found.end };
                candidates.push({ from: markedIsFrom ? marked : said, to: markedIsFrom ? said : marked, weight: found.weight });
            }
        }
    };
    collect(fromText, fromSpan, toText, toSpan, true);
    collect(toText, toSpan, fromText, fromSpan, false);
    // Numbers and Latin words kept as they are
    const kept = new Map();
    for (const match of toText.slice(toSpan.start, toSpan.end).matchAll(/\d+|[A-Za-z]{2,}/g)) {
        const key = match[0].toLowerCase();
        kept.set(key, [...(kept.get(key) ?? []), toSpan.start + match.index]);
    }
    for (const match of fromText.slice(fromSpan.start, fromSpan.end).matchAll(/\d+|[A-Za-z]{2,}/g)) {
        for (const at of kept.get(match[0].toLowerCase()) ?? []) {
            const start = fromSpan.start + match.index;
            candidates.push({ from: { start, end: start + match[0].length }, to: { start: at, end: at + match[0].length }, weight: match[0].length + 1 });
        }
    }
    return heaviestChain(candidates);
}

/** The heaviest set of candidates that keep the same order on both sides without overlapping. */
function heaviestChain(candidates) {
    if (candidates.length === 0) {
        return [];
    }
    candidates.sort((a, b) => a.from.start - b.from.start || a.to.start - b.to.start);
    const total = candidates.map(candidate => candidate.weight);
    const previous = candidates.map(() => -1);
    for (let index = 0; index < candidates.length; index++) {
        for (let before = 0; before < index; before++) {
            const fits = candidates[before].from.end <= candidates[index].from.start && candidates[before].to.end <= candidates[index].to.start;
            if (fits && total[before] + candidates[index].weight > total[index]) {
                total[index] = total[before] + candidates[index].weight;
                previous[index] = before;
            }
        }
    }
    const chain = [];
    for (let index = total.indexOf(Math.max(...total)); index !== -1; index = previous[index]) {
        chain.unshift(candidates[index]);
    }
    return chain;
}
