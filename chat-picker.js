// Selecting a character shows its chat list (with rename / export / delete / import)
// instead of opening the latest chat.
import { MODULE, getSettings } from './settings.js';
import { listChats, setActiveChat, renameChat, deleteChat, exportChat, importChats } from './chat-api.js';

const CHARACTER_LIST_ID = 'rm_print_characters_block';
// Classes ST puts on the character list while in bulk-edit / multi-select mode
const BULK_MODE_CLASSES = ['bulk_select', 'group_overlay_mode_select'];
const SEARCH_DEBOUNCE_MS = 300;
const TITLE = '편의성 모음';

const ITEM_ACTIONS = [
    ['rename', 'fa-pen', '이름 바꾸기'],
    ['export-jsonl', 'fa-file-export', '내보내기 (.jsonl)'],
    ['export-txt', 'fa-file-lines', '내보내기 (.txt)'],
    ['delete', 'fa-trash-can', '삭제'],
];

let isPickerOpen = false;

async function openCharacterAtChat(characterId, chatName) {
    const context = SillyTavern.getContext();
    const character = context.characters[characterId];
    if (chatName && character.chat !== chatName) {
        await setActiveChat(character, chatName);
    }
    await context.selectCharacterById(characterId);
}

function renderChatList(listElement, chats, activeChat, highlight = []) {
    const fragment = document.createDocumentFragment();
    const actionsHtml = ITEM_ACTIONS
        .map(([action, icon, label]) => `<div class="stqa_chat_action fa-solid ${icon}" data-action="${action}" title="${label}"></div>`)
        .join('');

    for (const chat of chats) {
        const item = document.createElement('div');
        item.className = 'stqa_chat_item';
        item.dataset.chat = chat.name;
        item.classList.toggle('stqa_active', chat.name === activeChat);
        item.classList.toggle('stqa_flash', highlight.includes(chat.name));

        const header = document.createElement('div');
        header.className = 'stqa_chat_header';
        const title = document.createElement('span');
        title.className = 'stqa_chat_name';
        title.textContent = chat.name;
        const meta = document.createElement('span');
        meta.className = 'stqa_chat_meta';
        meta.textContent = [chat.moment.isValid() ? chat.moment.format('lll') : '', chat.size, `${chat.count}💬`].filter(Boolean).join(' · ');
        header.append(title, meta);

        const preview = document.createElement('div');
        preview.className = 'stqa_chat_preview';
        preview.textContent = chat.preview;

        const actions = document.createElement('div');
        actions.className = 'stqa_chat_actions';
        actions.innerHTML = actionsHtml;

        item.append(header, preview, actions);
        fragment.append(item);
    }

    if (chats.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'stqa_chat_empty';
        empty.textContent = '채팅이 없어요.';
        fragment.append(empty);
    }

    listElement.replaceChildren(fragment);
}

async function askRename(character, name) {
    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    const input = await callGenericPopup('새 채팅 이름', POPUP_TYPE.INPUT, name, { okButton: '바꾸기', cancelButton: '취소' });
    const newName = typeof input === 'string' ? input.trim() : '';
    if (!newName || newName === name) {
        return null;
    }
    const existing = await listChats(character.avatar);
    if (existing?.some(chat => chat.name.toLowerCase() === newName.toLowerCase())) {
        toastr.warning('같은 이름의 채팅이 이미 있어요.', TITLE);
        return null;
    }
    return renameChat(character, name, newName);
}

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

async function askDelete(character, name) {
    const { Popup, POPUP_RESULT } = SillyTavern.getContext();
    // The popup renders HTML, and chat names are user-defined
    const answer = await Popup.show.confirm('채팅 삭제', `"${escapeHtml(name)}" 채팅을 삭제할까요? 되돌릴 수 없어요.`, { okButton: '삭제', cancelButton: '취소' });
    if (answer !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }
    await deleteChat(character, name);
    return true;
}

/**
 * @returns {Promise<{chat?: string, newChat?: boolean}|null>} The user's choice, or null if cancelled.
 */
async function showChatPicker(character, initialChats) {
    const { Popup, POPUP_TYPE, POPUP_RESULT, getThumbnailUrl } = SillyTavern.getContext();

    const root = document.createElement('div');
    root.className = 'stqa_picker';
    root.innerHTML = `
        <div class="stqa_picker_head">
            <img class="stqa_picker_avatar" alt="">
            <b class="stqa_picker_title"></b>
            <label class="menu_button stqa_picker_import" title="채팅 파일 불러오기 (.jsonl / .json)">
                <i class="fa-solid fa-file-import"></i> 불러오기
                <input type="file" accept=".jsonl,.json" multiple hidden>
            </label>
        </div>
        <input class="text_pole stqa_picker_search" type="search" placeholder="채팅 검색...">
        <div class="stqa_chat_list"></div>`;
    root.querySelector('.stqa_picker_avatar').src = getThumbnailUrl('avatar', character.avatar);
    root.querySelector('.stqa_picker_title').textContent = character.name;

    const listElement = root.querySelector('.stqa_chat_list');
    const searchInput = root.querySelector('.stqa_picker_search');
    renderChatList(listElement, initialChats, character.chat);

    // Stale search responses are dropped by sequence number
    let refreshSeq = 0;
    const refresh = async (highlight = []) => {
        const seq = ++refreshSeq;
        const chats = await listChats(character.avatar, searchInput.value.trim());
        if (seq === refreshSeq && chats) {
            renderChatList(listElement, chats, character.chat, highlight);
        }
    };

    let choice = null;
    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: '취소',
        allowVerticalScrolling: true,
        customButtons: [{ text: '새 채팅', icon: 'fa-plus', result: POPUP_RESULT.CUSTOM1 }],
    });

    const runItemAction = async (action, name) => {
        try {
            if (action === 'rename') {
                const renamed = await askRename(character, name);
                renamed && await refresh([renamed]);
            } else if (action === 'delete') {
                (await askDelete(character, name)) && await refresh();
            } else {
                await exportChat(character, name, action === 'export-txt' ? 'txt' : 'jsonl');
            }
        } catch (error) {
            console.error(`[${MODULE}] Chat action failed`, error);
            toastr.error('작업을 하지 못했어요.', TITLE);
        }
    };

    listElement.addEventListener('click', (event) => {
        const item = event.target.closest('.stqa_chat_item');
        if (!item) {
            return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action) {
            runItemAction(action, item.dataset.chat);
            return;
        }
        choice = { chat: item.dataset.chat };
        popup.complete(POPUP_RESULT.AFFIRMATIVE);
    });

    root.querySelector('.stqa_picker_import input').addEventListener('change', async (event) => {
        const files = [...event.target.files];
        event.target.value = '';
        if (files.length === 0) {
            return;
        }
        const imported = await importChats(character, files);
        if (imported.length > 0) {
            toastr.success(`채팅 ${imported.length}개를 불러왔어요.`, TITLE);
            await refresh(imported);
        }
    });

    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(refresh, SEARCH_DEBOUNCE_MS);
    });

    const result = await popup.show();
    clearTimeout(searchTimer);
    return result === POPUP_RESULT.CUSTOM1 ? { newChat: true } : choice;
}

async function openChatPicker(characterId) {
    if (isPickerOpen) {
        return;
    }
    isPickerOpen = true;

    const context = SillyTavern.getContext();
    try {
        const character = context.characters[characterId];
        const chats = await listChats(character.avatar);

        // No chats yet (or the list failed to load): fall back to ST's default behavior.
        if (!chats || chats.length === 0) {
            await context.selectCharacterById(characterId);
            return;
        }

        const choice = await showChatPicker(character, chats);
        if (choice?.newChat) {
            await openCharacterAtChat(characterId, `${character.name} - ${context.humanizedDateTime()}`);
        } else if (choice?.chat) {
            await openCharacterAtChat(characterId, choice.chat);
        }
    } catch (error) {
        console.error(`[${MODULE}] Chat picker failed`, error);
        toastr.error('채팅 목록을 열지 못했습니다.', TITLE);
    } finally {
        isPickerOpen = false;
    }
}

/**
 * Capture-phase listener so it runs before ST's delegated `.character_select` handler.
 * Only clicks that would switch to a different character are taken over.
 */
function onCharacterClickCapture(event) {
    if (!getSettings().chatPicker) {
        return;
    }
    const block = event.target.closest(`#${CHARACTER_LIST_ID} .character_select`);
    if (!block) {
        return;
    }
    const list = document.getElementById(CHARACTER_LIST_ID);
    if (BULK_MODE_CLASSES.some(cls => list.classList.contains(cls))) {
        return;
    }

    const context = SillyTavern.getContext();
    const characterId = Number(block.dataset.chid);
    if (!context.characters[characterId]) {
        return;
    }
    // Clicking the current character opens its card editor in ST; keep that.
    if (!context.groupId && String(context.characterId) === String(characterId)) {
        return;
    }

    event.stopImmediatePropagation();
    event.preventDefault();
    openChatPicker(characterId);
}

export function initChatPicker() {
    document.addEventListener('click', onCharacterClickCapture, true);
}
