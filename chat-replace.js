// "채팅 단어 바꾸기" in the Options menu: one word or phrase replaced in every message of the
// open chat (e.g. a year in a status panel, 2024 → 2205). Covers the other replies (swipes)
// and translations shown in place of the original. Plain text, not a pattern.
import { MODULE, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_replace';
const TITLE = '편의성 모음';

/** The texts of a message that can hold the word: [holder, key] pairs. */
function textSlots(message, swipes) {
    const slots = [[message, 'mes']];
    if (message.extra && typeof message.extra.display_text === 'string') {
        slots.push([message.extra, 'display_text']);
    }
    if (swipes && Array.isArray(message.swipes)) {
        message.swipes.forEach((_, index) => index !== message.swipe_id && slots.push([message.swipes, index]));
        (message.swipe_info ?? []).forEach((info, index) => {
            if (index !== message.swipe_id && typeof info?.extra?.display_text === 'string') {
                slots.push([info.extra, 'display_text']);
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

async function openReplace() {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;
    if (!context.chat.length) {
        toastr.info('열린 채팅이 없습니다.', TITLE);
        return;
    }
    const content = document.createElement('div');
    content.className = 'stqa_replace';
    content.innerHTML = `
        <h3>채팅 단어 바꾸기</h3>
        <div class="stqa_hint">지금 채팅의 모든 메시지에서 찾은 글자를 바꿉니다. 띄어쓰기와 대소문자까지 똑같은 것만 바뀌며, 되돌릴 수 없습니다.</div>
        <label>찾을 글자<input class="text_pole" data-field="find" type="text"></label>
        <label>바꿀 글자<input class="text_pole" data-field="to" type="text"></label>
        <label class="checkbox_label"><input type="checkbox" data-field="swipes" checked><span>다른 답변(스와이프)에서도 바꾸기</span></label>
        <div class="stqa_replace_count"></div>`;
    const field = name => content.querySelector(`[data-field="${name}"]`);
    const update = () => {
        const word = field('find').value;
        content.querySelector('.stqa_replace_count').textContent = word ? `${countIn(context.chat, word, field('swipes').checked)}곳 찾음` : '';
    };
    content.addEventListener('input', update);
    content.addEventListener('change', update);
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '바꾸기', cancelButton: '취소' });
    const shown = popup.show();
    setTimeout(() => field('find').focus());
    if (!await shown) {
        return;
    }
    const word = field('find').value;
    const replacement = field('to').value;
    const swipes = field('swipes').checked;
    const count = word ? countIn(context.chat, word, swipes) : 0;
    if (!count) {
        word && toastr.info('찾은 곳이 없습니다.', TITLE);
        return;
    }
    for (const message of context.chat) {
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
    await context.saveChat();
    await context.reloadCurrentChat();
    toastr.success(`${count}곳을 바꿨습니다.`, TITLE);
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
