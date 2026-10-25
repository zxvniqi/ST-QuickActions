// Edit / delete buttons that appear when text inside a message is selected.
import { MODULE, getSettings } from './settings.js';
import { countOccurrences, locateInSource, expandOverWrappers, removeRange } from './text-locate.js';

const TOOLBAR_ID = 'stqa_selection_toolbar';
const SELECTION_DEBOUNCE_MS = 150;
const TOOLBAR_GAP = 10;
const TITLE = '편의성 모음';

let toolbar = null;
let pending = null; // { messageId, selected, occurrence }
// Captured when a toolbar button is pressed: on phones the tap may clear the selection first.
let armed = null;
let selectionTimer = 0;
let isBusy = false;

function elementOf(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

/** Reads the current selection if it lies inside a single rendered message. */
function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    const mesText = elementOf(range.startContainer)?.closest('#chat .mes_text');
    if (!mesText || mesText !== elementOf(range.endContainer)?.closest('#chat .mes_text')) {
        return null;
    }
    const messageElement = mesText.closest('.mes');
    if (messageElement.querySelector('.edit_textarea')) {
        return null;
    }
    const selected = selection.toString();
    if (!selected.trim()) {
        return null;
    }

    // Which occurrence of this text on screen was picked, to pick the same one in the source
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(mesText);
    prefixRange.setEnd(range.startContainer, range.startOffset);

    return {
        messageId: Number(messageElement.getAttribute('mesid')),
        selected,
        occurrence: countOccurrences(prefixRange.toString(), selected),
        rect: range.getBoundingClientRect(),
    };
}

function hideToolbar() {
    pending = null;
    toolbar?.classList.remove('stqa_visible');
}

function showToolbar(info) {
    pending = info;
    toolbar.classList.add('stqa_visible');
    const { rect } = info;
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    // Below the selection, so it doesn't cover the phone's own copy/paste menu above it
    let top = rect.bottom + TOOLBAR_GAP;
    if (top + height > window.innerHeight - TOOLBAR_GAP) {
        top = Math.max(TOOLBAR_GAP, rect.top - height - TOOLBAR_GAP);
    }
    const left = Math.min(Math.max(TOOLBAR_GAP, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - TOOLBAR_GAP);
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
}

function onSelectionChange() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
        if (isBusy) {
            return;
        }
        const info = getSettings().selectionTools ? readSelection() : null;
        info ? showToolbar(info) : hideToolbar();
    }, SELECTION_DEBOUNCE_MS);
}

/** The text ST renders for a message, and which field it comes from. */
function getSourceField(message) {
    return message.extra?.display_text ? 'display_text' : 'mes';
}

function getSourceText(message, field) {
    return field === 'display_text' ? message.extra.display_text : message.mes;
}

async function applySourceText(messageId, field, text) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    if (field === 'display_text') {
        // Only the shown translation changes; MESSAGE_EDITED would make the translator redo it.
        message.extra.display_text = text;
    } else {
        message.mes = text;
        if (message.swipe_id !== undefined && Array.isArray(message.swipes)) {
            message.swipes[message.swipe_id] = text;
        }
        await context.eventSource.emit(context.eventTypes.MESSAGE_EDITED, messageId);
    }
    context.updateMessageBlock(messageId, message);
    await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
    await context.saveChat();
}

/** Resolves the pending selection to a range in the message source, or explains why not. */
function resolvePending() {
    const info = armed ?? pending;
    armed = null;
    const message = info && SillyTavern.getContext().chat[info.messageId];
    if (!message) {
        return null;
    }
    const field = getSourceField(message);
    const source = getSourceText(message, field);
    const range = locateInSource(source, info.selected, info.occurrence);
    if (!range) {
        toastr.warning('원문에서 이 부분을 찾지 못했어요. 연필 버튼으로 직접 고쳐주세요.', TITLE);
        return null;
    }
    return { ...info, field, source, range };
}

async function runAction(action) {
    if (isBusy) {
        return;
    }
    const target = resolvePending();
    hideToolbar();
    window.getSelection()?.removeAllRanges();
    if (!target) {
        return;
    }
    isBusy = true;
    try {
        await action(target);
    } catch (error) {
        console.error(`[${MODULE}] Selection action failed`, error);
        toastr.error('적용하지 못했어요.', TITLE);
    } finally {
        isBusy = false;
    }
}

async function editSelection({ messageId, field, source, range }) {
    const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
    const original = source.slice(range.start, range.end);
    const edited = await callGenericPopup('선택한 부분 수정', POPUP_TYPE.INPUT, original, {
        rows: 6,
        okButton: '적용',
        cancelButton: '취소',
    });
    if (typeof edited !== 'string' || edited === original) {
        return;
    }
    await applySourceText(messageId, field, source.slice(0, range.start) + edited + source.slice(range.end));
}

async function deleteSelection({ messageId, field, source, range }) {
    await applySourceText(messageId, field, removeRange(source, expandOverWrappers(source, range)));
    toastr.success('선택한 부분을 지웠어요. 이 알림을 누르면 되돌려요.', TITLE, {
        timeOut: 6000,
        onclick: () => applySourceText(messageId, field, source),
    });
}

function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.innerHTML = `
        <div class="stqa_sel_button" data-action="edit"><i class="fa-solid fa-pencil"></i> 수정</div>
        <div class="stqa_sel_button" data-action="delete"><i class="fa-solid fa-trash-can"></i> 삭제</div>`;
    // Keep the text selection alive while the button is pressed (mobile may clear it anyway)
    toolbar.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        armed = pending;
    });
    toolbar.addEventListener('mousedown', event => event.preventDefault());
    toolbar.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'edit') {
            runAction(editSelection);
        } else if (action === 'delete') {
            runAction(deleteSelection);
        }
    });
    document.body.append(toolbar);
}

export function initSelectionTools() {
    createToolbar();
    document.addEventListener('selectionchange', onSelectionChange);
    document.getElementById('chat')?.addEventListener('scroll', hideToolbar, { passive: true });
}
