// A delete button next to the message edit button (no need to enter edit mode).
import { MODULE, getSettings } from './settings.js';

const DELETE_BTN_CLASS = 'stqa_mes_delete';
const DELETE_ON_CLASS = 'stqa_delete_on';

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

/**
 * Mirrors ST's own edit-mode delete: same confirmation popup, and the
 * "delete swipe" choice for the last AI message with several swipes.
 */
async function deleteMessageAt(messageId) {
    const context = SillyTavern.getContext();
    if (typeof context.deleteMessage !== 'function') {
        toastr.warning('이 SillyTavern 버전은 지원되지 않습니다. 업데이트해 주세요.', '편의성 모음');
        return;
    }
    if (document.querySelector('#chat .edit_textarea')) {
        toastr.info('편집 중인 메시지를 먼저 닫아주세요.', '편의성 모음');
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
        toastr.error('메시지를 삭제하지 못했습니다.', '편의성 모음');
    } finally {
        isDeleting = false;
    }
}

export function applyDeleteButtonSetting() {
    document.body.classList.toggle(DELETE_ON_CLASS, getSettings().deleteButton);
}

export function initDeleteButton() {
    // ST clones #message_template for every new message, so patching the template covers
    // all future messages; already-rendered messages are patched once here.
    document.querySelectorAll('#message_template .mes_buttons, #chat .mes_buttons').forEach(injectDeleteButton);
    applyDeleteButtonSetting();
    document.getElementById('chat')?.addEventListener('click', onChatClick);
}
