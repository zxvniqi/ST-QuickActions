// A button next to ✎ (rename) on each chat in the chat list (Chat History) window: renames the
// chat after the persona or the character, with or without the date, picked from a short list
// that shows each resulting name.
import { MODULE, getSettings, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const TITLE = '편의성 모음';
const LIST_ID = 'select_chat_div';
// The date ST puts after a new chat's name
const DATE_PART = / - (\d{4}-\d{1,2}-\d{1,2}\s?@\d{1,2}h\s?\d{1,2}m\s?\d{1,2}s(?:\s?\d+ms)?)/;

const cleanName = name => String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim();
const pad = number => String(number).padStart(2, '0');

/** A time as ST writes it in chat names: 2026-11-05@12h30m15s */
function stDate(time) {
    const date = new Date(time);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}@${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
}

/** The persona tied to the chat (or the one in use) and the chat's date. */
async function chatFacts(context, character, fileName) {
    const response = await fetch('/api/chats/get', { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ ch_name: character.name, file_name: fileName, avatar_url: character.avatar }) });
    const lines = response.ok ? await response.json() : [];
    const header = Array.isArray(lines) ? lines[0] : null;
    const locked = header?.chat_metadata?.persona;
    const persona = cleanName((locked && context.powerUserSettings?.personas?.[locked]) || context.name1);
    const fromName = fileName.match(DATE_PART)?.[1];
    const created = header?.create_date ?? (Array.isArray(lines) ? lines[1]?.send_date : null);
    const time = Date.parse(created);
    return { persona, date: fromName ?? stDate(Number.isFinite(time) ? time : Date.now()) };
}

/** The name, or the name with (2), (3)... when another chat has it already. */
function freeName(name, taken, current) {
    let result = name;
    for (let n = 2; taken.has(result) && result !== current; n++) {
        result = `${name} (${n})`;
    }
    return result;
}

async function renameFromList(fileName) {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;
    const character = context.characters[context.characterId];
    if (!character || context.groupId) {
        toastr.info('캐릭터 채팅에서만 쓸 수 있습니다.', TITLE);
        return;
    }
    const [{ persona, date }, listed] = await Promise.all([
        chatFacts(context, character, fileName),
        fetch('/api/characters/chats', { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ avatar_url: character.avatar, simple: true }) }).then(response => (response.ok ? response.json() : {})),
    ]);
    const taken = new Set(Object.values(listed).map(item => String(item?.file_name ?? '').replace(/\.jsonl$/, '')));
    const charName = cleanName(character.name);
    const choices = [
        ['페르소나 이름', persona],
        ['페르소나 이름 + 날짜', `${persona} - ${date}`],
        ['캐릭터 이름', charName],
        ['캐릭터 이름 + 날짜', `${charName} - ${date}`],
    ].filter(([, name]) => name).map(([label, name]) => [label, freeName(name, taken, fileName)]);

    const content = document.createElement('div');
    content.className = 'stqa_rename_pick';
    content.innerHTML = '<h3>채팅 이름 바꾸기</h3><div class="stqa_hint"></div><div class="stqa_rename_choices"></div>';
    content.querySelector('.stqa_hint').textContent = `지금 이름: ${fileName}`;
    const box = content.querySelector('.stqa_rename_choices');
    choices.forEach(([label, name], index) => {
        const row = document.createElement('label');
        row.className = 'stqa_rename_choice';
        row.innerHTML = '<input type="radio" name="stqa_rename"><span><b></b><small></small></span>';
        row.querySelector('input').value = String(index);
        row.querySelector('input').checked = index === 0;
        row.querySelector('b').textContent = label;
        row.querySelector('small').textContent = name;
        box.append(row);
    });
    if (!await new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '변경', cancelButton: '취소' }).show()) {
        return;
    }
    const picked = choices[Number(content.querySelector('input:checked')?.value ?? 0)];
    if (!picked || picked[1] === fileName) {
        return;
    }
    await context.renameChat(fileName, picked[1]);
    // The list shows the new name the way ST's own ✎ does it: opened again
    setTimeout(() => {
        $('#option_select_chat').trigger('click');
        $('#options').hide();
    }, 250);
}

function addButtons() {
    if (!isOn('chatQuickRename')) {
        return;
    }
    for (const pencil of document.querySelectorAll(`#${LIST_ID} .renameChatButton`)) {
        if (!pencil.nextElementSibling?.classList.contains('stqa_chat_rename')) {
            const button = document.createElement('div');
            button.className = 'stqa_chat_rename hoverglow opacity50p fa-solid fa-signature fa-sm';
            button.title = '페르소나·캐릭터 이름으로 바꾸기';
            pencil.after(button);
        }
    }
}

function onClick(event) {
    const button = event.target.closest('.stqa_chat_rename');
    if (!button) {
        return;
    }
    // Not a tap on the chat itself (that opens it)
    event.stopPropagation();
    const fileName = button.closest('.select_chat_block_wrapper')?.querySelector('.select_chat_block_filename')?.textContent;
    fileName && renameFromList(fileName).catch((error) => {
        console.error(`[${MODULE}] Renaming the chat failed`, error);
        toastr.error('이름을 바꾸지 못했습니다.', TITLE);
    });
}

export function applyChatName() {
    document.body.classList.toggle('stqa_chat_rename_on', isOn('chatQuickRename'));
    addButtons();
}

export function initChatName() {
    // The automatic renaming of v2.11.0 is gone
    delete getSettings().chatNamePersona;
    const list = document.getElementById(LIST_ID);
    if (list) {
        list.addEventListener('click', onClick, true);
        new MutationObserver(records => !onlyOwnChanges(records) && addButtons()).observe(list, { childList: true, subtree: true });
    }
    applyChatName();
}
