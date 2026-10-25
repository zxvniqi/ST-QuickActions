// Quick Actions for SillyTavern
// 1. A delete button next to the message edit button (no need to enter edit mode).
// 2. Selecting a character shows its chat list instead of opening the latest chat.

const MODULE = 'st_quick_actions';

const defaultSettings = Object.freeze({
    deleteButton: true,
    chatPicker: true,
});

const DELETE_BTN_CLASS = 'stqa_mes_delete';
const DELETE_ON_CLASS = 'stqa_delete_on';
const CHARACTER_LIST_ID = 'rm_print_characters_block';
// Classes ST puts on the character list while in bulk-edit / multi-select mode
const BULK_MODE_CLASSES = ['bulk_select', 'group_overlay_mode_select'];
const SEARCH_DEBOUNCE_MS = 300;

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    const settings = extensionSettings[MODULE];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }
    return settings;
}

// ---------------------------------------------------------------------------
// Feature 1: delete button
// ---------------------------------------------------------------------------

let isDeleting = false;

function injectDeleteButton(mesButtons) {
    if (mesButtons.querySelector(`.${DELETE_BTN_CLASS}`)) {
        return;
    }
    const button = document.createElement('div');
    button.className = `mes_button ${DELETE_BTN_CLASS} fa-solid fa-trash-can`;
    button.title = '메시지 삭제';

    const editButton = mesButtons.querySelector('.mes_edit');
    editButton ? editButton.before(button) : mesButtons.append(button);
}

function installDeleteButtons() {
    // ST clones #message_template for every new message, so patching the template covers
    // all future messages; already-rendered messages are patched once here.
    document.querySelectorAll('#message_template .mes_buttons, #chat .mes_buttons').forEach(injectDeleteButton);
}

/**
 * Mirrors ST's own edit-mode delete: same confirmation popup, and the
 * "delete swipe" choice for the last AI message with several swipes.
 */
async function deleteMessageAt(messageId) {
    const context = SillyTavern.getContext();
    if (typeof context.deleteMessage !== 'function') {
        toastr.warning('이 SillyTavern 버전은 지원되지 않습니다. 업데이트해 주세요.', 'Quick Actions');
        return;
    }
    if (document.querySelector('#chat .edit_textarea')) {
        toastr.info('편집 중인 메시지를 먼저 닫아주세요.', 'Quick Actions');
        return;
    }

    const { chat, powerUserSettings } = context;
    const message = chat[messageId];
    if (!message) {
        return;
    }

    const askConfirmation = Boolean(powerUserSettings?.confirm_message_delete);
    const swipeCount = Array.isArray(message.swipes) ? message.swipes.length : 0;
    const canDeleteSwipe = askConfirmation
        && !message.is_user
        && swipeCount > 1
        && messageId === chat.length - 1
        && message.swipe_id !== undefined;

    await context.deleteMessage(messageId, canDeleteSwipe ? message.swipe_id : undefined, askConfirmation);
}

async function onChatClick(event) {
    const button = event.target.closest(`.${DELETE_BTN_CLASS}`);
    if (!button || isDeleting) {
        return;
    }
    const messageId = Number(button.closest('.mes')?.getAttribute('mesid'));
    if (!Number.isInteger(messageId)) {
        return;
    }

    isDeleting = true;
    try {
        await deleteMessageAt(messageId);
    } catch (error) {
        console.error(`[${MODULE}] Delete failed`, error);
        toastr.error('메시지를 삭제하지 못했습니다.', 'Quick Actions');
    } finally {
        isDeleting = false;
    }
}

function applyDeleteButtonSetting() {
    document.body.classList.toggle(DELETE_ON_CLASS, getSettings().deleteButton);
}

// ---------------------------------------------------------------------------
// Feature 2: chat picker on character select
// ---------------------------------------------------------------------------

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
        toastr.error('채팅 목록을 열지 못했습니다.', 'Quick Actions');
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

// ---------------------------------------------------------------------------
// Settings UI
// ---------------------------------------------------------------------------

function createSettingsUI() {
    const container = document.getElementById('extensions_settings2');
    if (!container) {
        return;
    }
    container.insertAdjacentHTML('beforeend', `
        <div id="${MODULE}_settings" class="extension_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Quick Actions</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label">
                        <input type="checkbox" data-setting="deleteButton">
                        <span>메시지 메뉴에 삭제 버튼 표시</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" data-setting="chatPicker">
                        <span>캐릭터 선택 시 채팅 목록 띄우기</span>
                    </label>
                </div>
            </div>
        </div>`);

    const settings = getSettings();
    const panel = document.getElementById(`${MODULE}_settings`);
    for (const input of panel.querySelectorAll('input[data-setting]')) {
        input.checked = settings[input.dataset.setting];
    }
    panel.addEventListener('change', (event) => {
        const key = event.target.dataset?.setting;
        if (!key) {
            return;
        }
        settings[key] = event.target.checked;
        SillyTavern.getContext().saveSettingsDebounced();
        if (key === 'deleteButton') {
            applyDeleteButtonSetting();
        }
    });
}

(function init() {
    installDeleteButtons();
    applyDeleteButtonSetting();
    document.getElementById('chat')?.addEventListener('click', onChatClick);
    document.addEventListener('click', onCharacterClickCapture, true);
    createSettingsUI();
})();
