// Selecting a character shows its chat list instead of opening the latest chat.
import { MODULE, getSettings } from './settings.js';

const CHARACTER_LIST_ID = 'rm_print_characters_block';
// Classes ST puts on the character list while in bulk-edit / multi-select mode
const BULK_MODE_CLASSES = ['bulk_select', 'group_overlay_mode_select'];
const SEARCH_DEBOUNCE_MS = 300;

let isPickerOpen = false;

/**
 * @returns {Promise<object[]|null>} Chats sorted newest first, or null on failure.
 */
async function fetchChats(avatar, query) {
    const context = SillyTavern.getContext();
    try {
        const response = await fetch('/api/chats/search', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ query, avatar_url: avatar, group_id: null }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const chats = await response.json();
        if (!Array.isArray(chats)) {
            return null;
        }
        for (const chat of chats) {
            chat.moment = context.timestampToMoment(chat.last_mes);
        }
        return chats.sort((a, b) => (b.moment.valueOf() || 0) - (a.moment.valueOf() || 0));
    } catch (error) {
        console.error(`[${MODULE}] Could not load chats`, error);
        return null;
    }
}

/** Saves the chosen chat as the character's active chat, the same way ST does. */
async function persistActiveChat(character, chatName) {
    const context = SillyTavern.getContext();
    character.chat = chatName;
    try {
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ avatar: character.avatar, chat: chatName }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn(`[${MODULE}] Could not persist active chat`, error);
    }
}

async function openCharacterAtChat(characterId, chatName) {
    const context = SillyTavern.getContext();
    const character = context.characters[characterId];
    if (chatName && character.chat !== chatName) {
        await persistActiveChat(character, chatName);
    }
    await context.selectCharacterById(characterId);
}

function renderChatList(listElement, chats, activeChat) {
    const fragment = document.createDocumentFragment();

    for (const chat of chats) {
        const name = chat.file_name.replace(/\.jsonl$/, '');

        const item = document.createElement('div');
        item.className = 'stqa_chat_item';
        item.dataset.chat = name;
        item.classList.toggle('stqa_active', name === activeChat);

        const header = document.createElement('div');
        header.className = 'stqa_chat_header';
        const title = document.createElement('span');
        title.className = 'stqa_chat_name';
        title.textContent = name;
        const meta = document.createElement('span');
        meta.className = 'stqa_chat_meta';
        meta.textContent = `${chat.moment.isValid() ? chat.moment.format('lll') : ''} · ${chat.message_count ?? 0}💬`;
        header.append(title, meta);

        const preview = document.createElement('div');
        preview.className = 'stqa_chat_preview';
        preview.textContent = chat.preview_message ?? '';

        item.append(header, preview);
        fragment.append(item);
    }

    if (chats.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'stqa_chat_empty';
        empty.textContent = '검색 결과가 없습니다.';
        fragment.append(empty);
    }

    listElement.replaceChildren(fragment);
}

/**
 * @returns {Promise<{chat?: string, newChat?: boolean}|null>} The user's choice, or null if cancelled.
 */
async function showChatPicker(character, chats) {
    const { Popup, POPUP_TYPE, POPUP_RESULT, getThumbnailUrl } = SillyTavern.getContext();

    const root = document.createElement('div');
    root.className = 'stqa_picker';
    root.innerHTML = `
        <div class="stqa_picker_head">
            <img class="stqa_picker_avatar" alt="">
            <b class="stqa_picker_title"></b>
        </div>
        <input class="text_pole stqa_picker_search" type="search" placeholder="채팅 검색...">
        <div class="stqa_chat_list"></div>`;
    root.querySelector('.stqa_picker_avatar').src = getThumbnailUrl('avatar', character.avatar);
    root.querySelector('.stqa_picker_title').textContent = character.name;

    const listElement = root.querySelector('.stqa_chat_list');
    const searchInput = root.querySelector('.stqa_picker_search');
    renderChatList(listElement, chats, character.chat);

    let choice = null;
    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: '취소',
        allowVerticalScrolling: true,
        customButtons: [{
            text: '새 채팅',
            icon: 'fa-plus',
            result: POPUP_RESULT.CUSTOM1,
        }],
    });

    listElement.addEventListener('click', (event) => {
        const item = event.target.closest('.stqa_chat_item');
        if (!item) {
            return;
        }
        choice = { chat: item.dataset.chat };
        popup.complete(POPUP_RESULT.AFFIRMATIVE);
    });

    // Server-side search matches message content too; stale responses are dropped.
    let searchTimer = 0;
    let searchSeq = 0;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const seq = ++searchSeq;
            const results = await fetchChats(character.avatar, searchInput.value.trim());
            if (seq === searchSeq && results) {
                renderChatList(listElement, results, character.chat);
            }
        }, SEARCH_DEBOUNCE_MS);
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
        const chats = await fetchChats(character.avatar, '');

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
        toastr.error('채팅 목록을 열지 못했습니다.', '편의성 모음');
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
