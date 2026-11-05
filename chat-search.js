// "채팅에서 찾기" in the Options menu: a search bar in place of the input. Typing a word finds the
// messages that have it, newest first; ▲ goes to the next older one, ▼ back to newer ones. The
// word is marked in the message shown (CSS highlights: the message's own text is never touched).
// The search runs over the chat's text in memory, so even long chats answer at once; messages
// not drawn yet are loaded the way 번호로 이동 does.
import { MODULE, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_search';
const BAR_ID = 'stqa_search_bar';
const HIGHLIGHT = 'stqa-find';
const TYPING_DELAY_MS = 250;

let bar = null;
let results = [];
let current = -1;
let formDisplay = '';
let timer = null;

const highlights = () => (typeof Highlight === 'function' && CSS.highlights ? CSS.highlights : null);

/** A message's text as read: the translation shown (if any) and the original, tags left out. */
function searchableText(message) {
    const shown = typeof message?.extra?.display_text === 'string' ? message.extra.display_text : '';
    return `${shown}\n${message?.mes ?? ''}`.replace(/<[^>]*>/g, ' ').toLowerCase();
}

function find(word) {
    const { chat } = SillyTavern.getContext();
    const needle = word.toLowerCase();
    const found = [];
    for (let index = chat.length - 1; index >= 0; index--) {
        if (searchableText(chat[index]).includes(needle)) {
            found.push(index);
        }
    }
    return found;
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

function clearMarks() {
    highlights()?.delete(HIGHLIGHT);
}

function setCount() {
    const count = bar?.querySelector('.stqa_search_count');
    if (count) {
        count.textContent = results.length ? `${current + 1}/${results.length}` : (wordOf() ? '0' : '');
    }
}

const wordOf = () => bar?.querySelector('input').value.trim() ?? '';

/** Goes to a found message: loads it if needed, marks the word, and brings the first mark into view. */
async function show(position) {
    if (!results.length) {
        return;
    }
    current = (position + results.length) % results.length;
    setCount();
    const index = results[current];
    const word = wordOf();
    const chat = document.getElementById('chat');
    if (!chat.querySelector(`.mes[mesid="${index}"]`)) {
        await SillyTavern.getContext().executeSlashCommandsWithOptions(`/chat-jump ${index}`);
    }
    const element = chat.querySelector(`.mes[mesid="${index}"]`);
    if (!element || results[current] !== index) {
        return;
    }
    const ranges = rangesIn(element, word);
    clearMarks();
    if (ranges.length) {
        highlights()?.set(HIGHLIGHT, new Highlight(...ranges));
    }
    // The first mark a third of the way down the chat (or the message's top, if the word isn't
    // in the drawn text, e.g. only in a status panel's code)
    const target = ranges[0]?.getBoundingClientRect() ?? element.getBoundingClientRect();
    const box = chat.getBoundingClientRect();
    const offset = ranges.length ? box.height / 3 : 0;
    chat.scrollTo({ top: chat.scrollTop + target.top - box.top - offset, behavior: 'instant' });
}

function search() {
    clearTimeout(timer);
    const word = wordOf();
    results = word ? find(word) : [];
    current = -1;
    clearMarks();
    setCount();
    if (results.length) {
        show(0).catch(error => console.error(`[${MODULE}] Search failed`, error));
    }
}

function step(direction) {
    // Typed but not searched yet: search first
    if (timer) {
        search();
        return;
    }
    // ▲ older (further down the list), ▼ newer
    show(current + (direction < 0 ? 1 : -1)).catch(error => console.error(`[${MODULE}] Search failed`, error));
}

function stop() {
    if (!bar) {
        return;
    }
    clearTimeout(timer);
    timer = null;
    clearMarks();
    results = [];
    current = -1;
    bar.remove();
    bar = null;
    const form = document.getElementById('send_form');
    if (form) {
        form.style.display = formDisplay;
    }
}

function start() {
    const form = document.getElementById('send_form');
    if (!form || !SillyTavern.getContext().chat.length) {
        toastr.info('찾을 메시지가 없습니다.', '편의성 모음');
        return;
    }
    if (bar) {
        bar.querySelector('input').focus();
        return;
    }
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.innerHTML = `
        <input class="text_pole" type="search" enterkeyhint="search" placeholder="채팅에서 찾을 단어">
        <span class="stqa_search_count"></span>
        <div class="menu_button fa-solid fa-chevron-up" data-step="up" title="이전(위) 결과"></div>
        <div class="menu_button fa-solid fa-chevron-down" data-step="down" title="다음(아래) 결과"></div>
        <div class="menu_button fa-solid fa-xmark" data-step="close" title="닫기"></div>`;
    const input = bar.querySelector('input');
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            search();
        }, TYPING_DELAY_MS);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            // Enter: search, then each Enter the next older one
            timer || !results.length ? search() : step(-1);
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
