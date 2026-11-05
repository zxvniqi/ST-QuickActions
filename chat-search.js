// "채팅에서 찾기" in the Options menu. The search box shows above the chat (under the top bar, or
// under a chat top bar extension's bar), the ▲ / ▼ / ✕ buttons in place of the input. Typing a word
// goes to the last place it shows in the newest message that has it; ▲ goes to the next place up
// the chat (the one above in the same message, then into older messages), ▼ back down. Every place
// in the message is marked, the current one more strongly (CSS highlights: the message's own text
// is never touched). The search runs over the chat's text in memory, so even long chats answer at
// once; a message whose shown text turns out not to have the word (a regex hides it, it is in a
// status panel's code) is skipped when it is reached. Messages not drawn yet are loaded the way
// 번호로 이동 does. A message drawn again meanwhile (a translation coming in) is marked again.
import { MODULE, isOn } from './settings.js';
import { showForReal } from './floating-panel.js';

const OPTION_ID = 'stqa_option_search';
const TOP_ID = 'stqa_search_top';
const BAR_ID = 'stqa_search_bar';
const HIGHLIGHT = 'stqa-find';
const HIGHLIGHT_CURRENT = 'stqa-find-current';
const TYPING_DELAY_MS = 250;
// Checks after a jump: messages are still being drawn (translations, pictures, status panels)
const RECHECK_MS = [150, 500, 1200];

let top = null;
let bar = null;
// Messages with the word, newest first; the one shown; the places in it; the place shown
let results = [];
let current = -1;
let places = [];
let place = -1;
let formDisplay = '';
let timer = null;
let rechecks = [];

// The word last searched for, and whether this is a phone (a finger, no mouse)
let searched = '';
const TOUCH = () => window.matchMedia('(pointer: coarse)').matches;

const highlights = () => (typeof Highlight === 'function' && CSS.highlights ? CSS.highlights : null);
const wordOf = () => top?.querySelector('input').value.trim() ?? '';

/** A message's text as read: the translation shown (if any) and the original, tags left out. */
function searchableText(message) {
    const shown = typeof message?.extra?.display_text === 'string' ? message.extra.display_text : '';
    return `${shown}\n${message?.mes ?? ''}`.replace(/<[^>]*>/g, ' ').toLowerCase();
}

/** Ranges of every place the word is in the message's drawn text (within one text piece each). */
function rangesIn(element, word) {
    const needle = word.toLowerCase();
    const ranges = [];
    const walker = document.createTreeWalker(element.querySelector('.mes_text') ?? element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue.toLowerCase();
        for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
            const range = new Range();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            ranges.push(range);
        }
    }
    return ranges;
}

const drawnMessage = index => document.querySelector(`#chat .mes[mesid="${index}"]`);

/** Messages with the word, newest first; drawn ones only where the word shows. */
function find(word) {
    const { chat } = SillyTavern.getContext();
    const needle = word.toLowerCase();
    const found = [];
    for (let index = chat.length - 1; index >= 0; index--) {
        if (!searchableText(chat[index]).includes(needle)) {
            continue;
        }
        const element = drawnMessage(index);
        if (!element || rangesIn(element, word).length) {
            found.push(index);
        }
    }
    return found;
}

function clearMarks() {
    highlights()?.delete(HIGHLIGHT);
    highlights()?.delete(HIGHLIGHT_CURRENT);
}

function cancelRechecks() {
    rechecks.forEach(clearTimeout);
    rechecks = [];
}

function setCount() {
    const count = bar?.querySelector('.stqa_search_count');
    if (!count) {
        return;
    }
    if (!results.length) {
        count.textContent = wordOf() ? '0' : '';
        return;
    }
    // Which message, and which place in it when it has several
    count.textContent = `${current + 1}/${results.length}${places.length > 1 ? ` · ${place + 1}/${places.length}` : ''}`;
}

/** Marks the places in the message shown, the current one more strongly. */
function mark() {
    clearMarks();
    if (!places.length) {
        return;
    }
    highlights()?.set(HIGHLIGHT, new Highlight(...places));
    const currentMark = new Highlight(places[place]);
    currentMark.priority = 1;
    highlights()?.set(HIGHLIGHT_CURRENT, currentMark);
}

/** Brings the current place a third of the way down the chat (the message drawn for real first). */
function bringIntoView() {
    const chat = document.getElementById('chat');
    const range = places[place];
    if (!chat || !range) {
        return;
    }
    const element = range.startContainer.parentElement?.closest('.mes');
    if (element) {
        showForReal([element.previousElementSibling, element, element.nextElementSibling]);
    }
    const target = range.getBoundingClientRect();
    const box = chat.getBoundingClientRect();
    const wanted = box.top + box.height / 3;
    if (Math.abs(target.top - wanted) > 4) {
        chat.scrollTo({ top: chat.scrollTop + target.top - wanted, behavior: 'instant' });
    }
}

/**
 * The message may be drawn again just after the jump (a translation arriving, a status panel
 * filling in): its places are found again in the new text, and the current one brought back.
 */
function watchCurrent() {
    cancelRechecks();
    const word = wordOf();
    const index = results[current];
    rechecks = RECHECK_MS.map(delay => setTimeout(() => {
        if (word !== wordOf() || results[current] !== index || !places.length) {
            return;
        }
        // Redrawn: the text pieces may be gone, or kept and given new text (then the place no
        // longer holds the word)
        const stale = range => !range.startContainer.isConnected || range.toString().toLowerCase() !== word.toLowerCase();
        if (places.some(stale)) {
            const element = drawnMessage(index);
            const fresh = element ? rangesIn(element, word) : [];
            if (!fresh.length) {
                return;
            }
            // The same place counted from the same end it was reached from
            const fromEnd = places.length - 1 - place;
            place = fresh.length === places.length ? place : Math.max(0, fresh.length - 1 - fromEnd);
            places = fresh;
            setCount();
            mark();
        }
        bringIntoView();
    }, delay));
}

/** Shows a place in the message shown now. */
function showPlace(at) {
    place = at;
    setCount();
    mark();
    bringIntoView();
    watchCurrent();
}

/**
 * Goes to a found message (loading it if needed) and to its last place (`fromEnd`, coming from
 * below) or its first. One whose shown text hasn't the word is dropped, and the next one that way
 * is shown.
 */
async function showMessage(position, older, fromEnd) {
    const word = wordOf();
    cancelRechecks();
    while (results.length) {
        current = (position + results.length) % results.length;
        const index = results[current];
        if (!drawnMessage(index)) {
            await SillyTavern.getContext().executeSlashCommandsWithOptions(`/chat-jump ${index}`);
        }
        // Typed something else meanwhile
        if (word !== wordOf() || results[current] !== index) {
            return;
        }
        const element = drawnMessage(index);
        // Drawn for real before measuring (chat virtualizers leave messages out of sight undrawn)
        if (element) {
            showForReal([element.previousElementSibling, element, element.nextElementSibling]);
        }
        places = element ? rangesIn(element, word) : [];
        if (!places.length) {
            results.splice(current, 1);
            // The next one the same way: older ones are after it in the list, newer before
            position = older ? current : current - 1;
            continue;
        }
        showPlace(fromEnd ? places.length - 1 : 0);
        return;
    }
    current = -1;
    places = [];
    clearMarks();
    setCount();
}

function search() {
    clearTimeout(timer);
    timer = null;
    cancelRechecks();
    const word = wordOf();
    searched = word;
    results = word ? find(word) : [];
    current = -1;
    places = [];
    clearMarks();
    setCount();
    // The newest message, its last place: the one nearest the bottom
    if (results.length) {
        showMessage(0, true, true).catch(error => console.error(`[${MODULE}] Search failed`, error));
    }
}

function step(direction) {
    // Typed but not searched yet: search first
    if (timer || current === -1) {
        search();
        return;
    }
    const up = direction < 0;
    // Within the message first
    if (up ? place > 0 : place < places.length - 1) {
        showPlace(place + (up ? -1 : 1));
        return;
    }
    // Up: the next older message (later in the list), reached from below, so its last place
    const next = up ? current + 1 : current - 1;
    showMessage(next, up, up).catch(error => console.error(`[${MODULE}] Search failed`, error));
}

function stop() {
    if (!bar) {
        return;
    }
    clearTimeout(timer);
    timer = null;
    cancelRechecks();
    clearMarks();
    results = [];
    current = -1;
    places = [];
    searched = '';
    top?.remove();
    bar.remove();
    top = bar = null;
    const form = document.getElementById('send_form');
    if (form) {
        form.style.display = formDisplay;
    }
}

function start() {
    const form = document.getElementById('send_form');
    const chat = document.getElementById('chat');
    if (!form || !chat || !SillyTavern.getContext().chat.length) {
        toastr.info('찾을 메시지가 없습니다.', '편의성 모음');
        return;
    }
    if (bar) {
        top.querySelector('input').focus();
        return;
    }
    // The box: right above the chat, so under the top bar or a chat top bar extension's bar
    top = document.createElement('div');
    top.id = TOP_ID;
    top.innerHTML = '<input class="text_pole" type="search" enterkeyhint="search" placeholder="채팅에서 찾을 단어">';
    top.style.order = getComputedStyle(chat).order;
    chat.before(top);
    // The buttons: in place of the input
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.innerHTML = `
        <span class="stqa_search_count"></span>
        <div class="menu_button fa-solid fa-chevron-up" data-step="up" title="다음 결과 (위로)"></div>
        <div class="menu_button fa-solid fa-chevron-down" data-step="down" title="이전 결과 (아래로)"></div>
        <div class="menu_button fa-solid fa-xmark" data-step="close" title="닫기"></div>`;
    const input = top.querySelector('input');
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(search, TYPING_DELAY_MS);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            // The Enter that only finishes a Korean (IME) word is not one of the user's
            if (event.isComposing || event.keyCode === 229) {
                return;
            }
            // Phones: Enter searches and puts the keyboard away (moving on is for ▲ / ▼, so a
            // second Enter can't skip the first result). Computers: Enter also goes on to the next
            if (TOUCH()) {
                if (timer || wordOf() !== searched) {
                    search();
                }
                input.blur();
                return;
            }
            step(-1);
        } else if (event.key === 'Escape') {
            stop();
        }
    });
    bar.addEventListener('click', (event) => {
        const action = event.target.closest('[data-step]')?.dataset.step;
        if (action === 'close') {
            stop();
        } else if (action) {
            step(action === 'up' ? -1 : 1);
        }
    });
    formDisplay = form.style.display;
    form.style.display = 'none';
    form.after(bar);
    input.focus();
}

export function applyChatSearch() {
    const item = document.getElementById(OPTION_ID);
    if (item) {
        item.hidden = !isOn('chatSearch');
    }
    if (!isOn('chatSearch')) {
        stop();
    }
}

export function initChatSearch() {
    const menu = document.querySelector('#options .options-content');
    if (!menu) {
        return;
    }
    const item = document.createElement('a');
    item.id = OPTION_ID;
    item.innerHTML = '<i class="fa-lg fa-solid fa-magnifying-glass"></i><span>채팅에서 찾기</span>';
    item.addEventListener('click', () => {
        // Close the Options menu the way its own button does
        if (document.getElementById('options')?.style.display !== 'none') {
            document.getElementById('options_button')?.click();
        }
        start();
    });
    menu.append(item);
    applyChatSearch();
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, stop);
}
