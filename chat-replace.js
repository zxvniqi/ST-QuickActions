// "채팅 단어 바꾸기" in the Options menu: one word or phrase replaced in every message of the
// open chat (e.g. a year in a status panel, 2024 → 2205). Covers the other replies (swipes)
// and translations shown in place of the original. Plain text, not a pattern. The places it
// would change are shown before anything is changed, and a change can be taken back until the
// page is reloaded (its notice, or the list in the window).
import { MODULE, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_replace';
const TITLE = '편의성 모음';
// Places shown in the preview (the count covers them all)
const PREVIEW_MAX = 50;
// Text shown around each place in the preview
const AROUND = 18;

// Changes made since the page was loaded, newest last: { chatId, word, replacement, count, changes }
const done = [];

/** A reply is being written (ST shows its stop button then). */
const isGenerating = () => Boolean(document.getElementById('mes_stop')?.offsetParent);

/**
 * The texts of a message that can hold the word: [holder, key, label] (the label tells where it
 * is: the message, its translation, another reply...).
 */
function textSlots(message, swipes) {
    const slots = [[message, 'mes', '']];
    if (message.extra && typeof message.extra.display_text === 'string') {
        slots.push([message.extra, 'display_text', '번역']);
    }
    if (swipes && Array.isArray(message.swipes)) {
        message.swipes.forEach((_, index) => index !== message.swipe_id && slots.push([message.swipes, index, `스와이프 ${index + 1}`]));
        (message.swipe_info ?? []).forEach((info, index) => {
            if (index !== message.swipe_id && typeof info?.extra?.display_text === 'string') {
                slots.push([info.extra, 'display_text', `스와이프 ${index + 1} 번역`]);
            }
        });
    }
    return slots.filter(([holder, key]) => typeof holder[key] === 'string');
}

function countIn(chat, word, swipes) {
    let count = 0;
    for (const message of chat) {
        for (const [holder, key] of textSlots(message, swipes)) {
            count += holder[key].split(word).length - 1;
        }
    }
    return count;
}

const oneLine = text => text.replace(/\s+/g, ' ');

/** The first places the word is found: [{ index, name, label, before, after }]. */
function previewOf(chat, word, swipes) {
    const found = [];
    chat.forEach((message, index) => {
        for (const [holder, key, label] of textSlots(message, swipes)) {
            const text = holder[key];
            for (let at = text.indexOf(word); at !== -1 && found.length < PREVIEW_MAX; at = text.indexOf(word, at + word.length)) {
                const start = Math.max(0, at - AROUND);
                const end = Math.min(text.length, at + word.length + AROUND);
                found.push({
                    index,
                    name: message.name ?? '',
                    label,
                    before: (start > 0 ? '…' : '') + oneLine(text.slice(start, at)),
                    after: oneLine(text.slice(at + word.length, end)) + (end < text.length ? '…' : ''),
                });
            }
        }
    });
    return found;
}

/** Draws the preview: each place with the word struck out and its replacement after it. */
function drawPreview(list, places, replacement) {
    list.replaceChildren(...places.map(({ index, name, label, before, after }) => {
        const row = document.createElement('div');
        row.className = 'stqa_replace_row';
        row.innerHTML = '<span class="stqa_replace_where"></span><span class="stqa_replace_text"><span></span><del></del><ins></ins><span></span></span>';
        // Message text is set as text: messages hold anything
        row.querySelector('.stqa_replace_where').textContent = `#${index} ${name}${label ? ` · ${label}` : ''}`;
        const parts = row.querySelectorAll('.stqa_replace_text > *');
        parts[0].textContent = before;
        parts[1].textContent = list.dataset.word;
        parts[2].textContent = replacement;
        parts[3].textContent = after;
        return row;
    }));
}

/**
 * Every text of the chat that can be changed, by place: { 'index|path': value }. Kept before and
 * after a change, so the change is known place by place (by message number: the chat is loaded
 * again after saving, so the message objects themselves don't stay the same).
 */
function textsOf(chat) {
    const texts = new Map();
    chat.forEach((message, index) => {
        const put = (path, value) => typeof value === 'string' && texts.set(`${index}|${path}`, value);
        put('mes', message.mes);
        put('extra.display_text', message.extra?.display_text);
        (Array.isArray(message.swipes) ? message.swipes : []).forEach((swipe, at) => put(`swipes.${at}`, swipe));
        (message.swipe_info ?? []).forEach((info, at) => put(`swipe_info.${at}.extra.display_text`, info?.extra?.display_text));
    });
    return texts;
}

/** Writes one text back by its place (the message must still be the one it was, by its date). */
function setText(message, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let holder = message;
    for (const key of keys) {
        holder = holder?.[key];
    }
    if (holder && typeof holder[last] === 'string') {
        holder[last] = value;
        return true;
    }
    return false;
}

function getText(message, path) {
    return path.split('.').reduce((holder, key) => holder?.[key], message);
}

/** Takes one change back: only places still as the change left them (not edited since). */
async function undo(record) {
    const context = SillyTavern.getContext();
    if (context.getCurrentChatId() !== record.chatId) {
        toastr.warning('그 채팅을 연 상태에서 되돌릴 수 있습니다.', TITLE);
        return;
    }
    if (isGenerating()) {
        toastr.info('답변을 만드는 중에는 되돌릴 수 없습니다.', TITLE);
        return;
    }
    let restored = 0;
    let kept = 0;
    for (const { index, sentAt, path, before, after } of record.changes) {
        const message = context.chat[index];
        if (message && message.send_date === sentAt && getText(message, path) === after && setText(message, path, before)) {
            restored++;
        } else {
            kept++;
        }
    }
    done.splice(done.indexOf(record), 1);
    if (!restored) {
        toastr.info('되돌릴 곳이 남아 있지 않습니다.', TITLE);
        return;
    }
    await context.saveChat();
    await context.reloadCurrentChat();
    toastr.success(kept ? `되돌렸습니다. (그 뒤 바뀐 ${kept}곳은 그대로)` : '되돌렸습니다.', TITLE);
}

const runUndo = record => undo(record).catch(error => console.error(`[${MODULE}] Undoing failed`, error));

async function openReplace() {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;
    if (!context.chat.length) {
        toastr.info('열린 채팅이 없습니다.', TITLE);
        return;
    }
    if (isGenerating()) {
        toastr.info('답변을 만드는 중에는 쓸 수 없습니다.', TITLE);
        return;
    }
    // The chat this window is about
    const chatId = context.getCurrentChatId();
    const chat = context.chat;
    const content = document.createElement('div');
    content.className = 'stqa_replace';
    content.innerHTML = `
        <h3>채팅 단어 바꾸기</h3>
        <label>찾을 글자<input class="text_pole" data-field="find" type="text"></label>
        <label>바꿀 글자<input class="text_pole" data-field="to" type="text"></label>
        <label class="checkbox_label"><input type="checkbox" data-field="swipes" checked><span>다른 답변(스와이프)에서도 바꾸기</span></label>
        <div class="stqa_replace_count"></div>
        <div class="stqa_replace_preview"></div>
        <div class="stqa_replace_undo"></div>`;
    const field = name => content.querySelector(`[data-field="${name}"]`);
    const list = content.querySelector('.stqa_replace_preview');
    let timer = null;
    const update = () => {
        clearTimeout(timer);
        // A long chat is searched once typing pauses
        timer = setTimeout(() => {
            const word = field('find').value;
            const swipes = field('swipes').checked;
            const count = word ? countIn(chat, word, swipes) : 0;
            content.querySelector('.stqa_replace_count').textContent = word ? `${count}곳${count > PREVIEW_MAX ? ` · 앞의 ${PREVIEW_MAX}곳만 보임` : ''}` : '';
            list.dataset.word = word;
            drawPreview(list, word ? previewOf(chat, word, swipes) : [], field('to').value);
        }, chat.length > 300 ? 250 : 80);
    };
    content.addEventListener('input', update);
    content.addEventListener('change', update);
    // Changes made earlier in this chat (until the page is reloaded): each can be taken back
    const undoBox = content.querySelector('.stqa_replace_undo');
    let popup = null;
    for (const record of done.filter(entry => entry.chatId === chatId).reverse()) {
        const row = document.createElement('div');
        row.className = 'stqa_replace_done';
        row.innerHTML = '<span></span><div class="menu_button menu_button_icon" title="되돌리기"><i class="fa-solid fa-rotate-left"></i></div>';
        row.querySelector('span').textContent = `${record.word} → ${record.replacement || '(지움)'} · ${record.count}곳`;
        row.querySelector('.menu_button').addEventListener('click', () => {
            popup?.complete(null);
            runUndo(record);
        });
        undoBox.append(row);
    }
    popup = new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '바꾸기', cancelButton: '취소' });
    const shown = popup.show();
    setTimeout(() => field('find').focus());
    if (!await shown) {
        return;
    }
    // Another chat opened, or a reply started, while the window was up: nothing is touched
    if (SillyTavern.getContext().getCurrentChatId() !== chatId || SillyTavern.getContext().chat !== chat) {
        toastr.warning('그사이 채팅이 바뀌어서 바꾸지 않았습니다.', TITLE);
        return;
    }
    if (isGenerating()) {
        toastr.warning('답변을 만드는 중에는 바꿀 수 없습니다.', TITLE);
        return;
    }
    const word = field('find').value;
    const replacement = field('to').value;
    const swipes = field('swipes').checked;
    const count = word ? countIn(chat, word, swipes) : 0;
    if (!count) {
        word && toastr.info('찾은 곳이 없습니다.', TITLE);
        return;
    }
    const before = textsOf(chat);
    for (const message of chat) {
        for (const [holder, key] of textSlots(message, swipes)) {
            holder[key] = holder[key].split(word).join(replacement);
        }
        // The reply on show is kept twice (as the message and as its swipe): both say the same
        const shown = message.swipe_id;
        if (Array.isArray(message.swipes) && typeof message.swipes[shown] === 'string') {
            message.swipes[shown] = message.mes;
        }
        const info = message.swipe_info?.[shown]?.extra;
        if (info && typeof info.display_text === 'string' && typeof message.extra?.display_text === 'string') {
            info.display_text = message.extra.display_text;
        }
    }
    const changes = [];
    for (const [place, after] of textsOf(chat)) {
        if (before.has(place) && before.get(place) !== after) {
            const [index, path] = [Number(place.slice(0, place.indexOf('|'))), place.slice(place.indexOf('|') + 1)];
            changes.push({ index, sentAt: chat[index].send_date, path, before: before.get(place), after });
        }
    }
    const record = { chatId, word, replacement, count, changes };
    done.push(record);
    await context.saveChat();
    await context.reloadCurrentChat();
    // Tapping the notice takes it back (the window also lists it until the page is reloaded)
    toastr.success(`${count}곳을 바꿨습니다. 누르면 되돌립니다.`, TITLE, { onclick: () => done.includes(record) && runUndo(record) });
}

export function applyChatReplace() {
    const item = document.getElementById(OPTION_ID);
    if (item) {
        item.hidden = !isOn('chatReplace');
    }
}

export function initChatReplace() {
    const menu = document.querySelector('#options .options-content');
    if (!menu) {
        return;
    }
    const item = document.createElement('a');
    item.id = OPTION_ID;
    item.innerHTML = '<i class="fa-lg fa-solid fa-right-left"></i><span>채팅 단어 바꾸기</span>';
    item.addEventListener('click', () => {
        // Close the Options menu the way its own button does
        if (document.getElementById('options')?.style.display !== 'none') {
            document.getElementById('options_button')?.click();
        }
        openReplace().catch(error => console.error(`[${MODULE}] Replacing failed`, error));
    });
    menu.append(item);
    applyChatReplace();
}
