// "채팅에서 찾기" in the Options menu. The search box shows above the chat (under the top bar, or
// under a chat top bar extension's bar), the ▲ / ▼ / ✕ buttons in place of the input. Typing a word
// finds the messages that have it, newest first; ▲ goes to the next result (older, up the chat),
// ▼ back to the previous one. The word is marked where it shows (CSS highlights: the message's own text is never
// touched). The search runs over the chat's text in memory, so even long chats answer at once;
// a message whose shown text turns out not to have the word (a regex hides it, it is in a status
// panel's code) is skipped when it is reached. Messages not drawn yet are loaded the way 번호로
// 이동 does.
import { MODULE, isOn } from './settings.js';
import { showForReal } from './floating-panel.js';

const OPTION_ID = 'stqa_option_search';
const TOP_ID = 'stqa_search_top';
const BAR_ID = 'stqa_search_bar';
const HIGHLIGHT = 'stqa-find';
const TYPING_DELAY_MS = 250;

let top = null;
let bar = null;
let results = [];
let current = -1;
let formDisplay = '';
let timer = null;

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
}

function setCount() {
    const count = bar?.querySelector('.stqa_search_count');
    if (count) {
        count.textContent = results.length ? `${current + 1}/${results.length}` : (wordOf() ? '0' : '');
    }
}

/**
 * Goes to a found message: loads it if needed, marks the word, and brings the first mark into
 * view. One whose shown text hasn't the word is dropped, and the next one that way is shown.
 */
async function show(position, direction = 1) {
    const word = wordOf();
    const chat = document.getElementById('chat');
    while (results.length) {
        current = (position + results.length) % results.length;
        const index = results[current];
        if (!drawnMessage(index)) {
            await SillyTavern.getContext().executeSlashCommandsWithOptions(`/chat-jump ${index}`);
        }
        const element = drawnMessage(index);
        // Typed something else meanwhile
        if (word !== wordOf() || results[current] !== index) {
            return;
        }
        // Drawn for real before measuring (chat virtualizers leave messages out of sight undrawn)
        if (element) {
            showForReal([element.previousElementSibling, element, element.nextElementSibling]);
        }
        const ranges = element ? rangesIn(element, word) : [];
        if (!ranges.length) {
            results.splice(current, 1);
            // The next one the same way: older ones are after it in the list, newer before
            position = direction > 0 ? current : current - 1;
            continue;
        }
        setCount();
        clearMarks();
        highlights()?.set(HIGHLIGHT, new Highlight(...ranges));
        // The first mark a third of the way down the chat
        const target = ranges[0].getBoundingClientRect();
        const box = chat.getBoundingClientRect();
        chat.scrollTo({ top: chat.scrollTop + target.top - box.top - box.height / 3, behavior: 'instant' });
        return;
    }
    current = -1;
    clearMarks();
    setCount();
}

function search() {
    clearTimeout(timer);
    timer = null;
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
    if (timer || current === -1) {
        search();
        return;
    }
    // ▲ older (further down the list), ▼ newer
    const older = direction < 0;
    show(current + (older ? 1 : -1), older ? 1 : -1).catch(error => console.error(`[${MODULE}] Search failed`, error));
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
            // Enter: search, then each Enter the next older one
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
