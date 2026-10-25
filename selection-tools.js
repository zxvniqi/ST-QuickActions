// Edit / delete buttons that appear when text inside a message is selected.
import { MODULE, getSettings } from './settings.js';
import { countOccurrences, locateInSource, expandOverWrappers, removeRange, mapToSameParagraphs } from './text-locate.js';

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

const MAX_DODGE_STEPS = 4;
// Elements covering more than this share of the screen are layout containers, not floating buttons
const CONTAINER_AREA_RATIO = 0.25;

/** The nearest fixed/absolute-positioned ancestor that is small enough to be a floating button. */
function floatingAncestor(element) {
    const screenArea = window.innerWidth * window.innerHeight;
    for (let node = element; node && node !== document.body; node = node.parentElement) {
        const { position } = getComputedStyle(node);
        if (position === 'fixed' || position === 'absolute' || position === 'sticky') {
            const rect = node.getBoundingClientRect();
            return rect.width * rect.height < screenArea * CONTAINER_AREA_RATIO ? node : null;
        }
    }
    return null;
}

/** A floating element (e.g. another extension's button) under the given box, if any. */
function findBlocker(top, left, width, height) {
    const points = [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9]];
    for (const [fx, fy] of points) {
        for (const element of document.elementsFromPoint(left + width * fx, top + height * fy)) {
            if (toolbar.contains(element)) {
                continue;
            }
            const blocker = floatingAncestor(element);
            if (blocker) {
                return blocker.getBoundingClientRect();
            }
            break; // only the topmost non-toolbar element matters
        }
    }
    return null;
}

/** Moves the box up past floating elements sitting where it would appear. */
function dodgeFloatingElements(position, width, height) {
    let { top } = position;
    for (let step = 0; step < MAX_DODGE_STEPS; step++) {
        const blocker = findBlocker(top, position.left, width, height);
        if (!blocker || blocker.top - height - TOOLBAR_GAP < TOOLBAR_GAP) {
            break;
        }
        top = blocker.top - height - TOOLBAR_GAP;
    }
    return { top, left: position.left };
}

/**
 * 'dock' (default) pins the toolbar above the chat input, away from the phone's own copy/paste
 * bar and other extensions' menus around the selection; 'above' / 'below' follow the selection.
 */
function computePosition(rect, width, height) {
    const clampTop = top => Math.min(Math.max(TOOLBAR_GAP, top), window.innerHeight - height - TOOLBAR_GAP);
    const position = getSettings().selectionToolbarPosition;

    if (position === 'above' || position === 'below') {
        const aboveTop = rect.top - height - TOOLBAR_GAP;
        const belowTop = rect.bottom + TOOLBAR_GAP;
        const top = position === 'above'
            ? (aboveTop >= TOOLBAR_GAP ? aboveTop : belowTop)
            : (belowTop + height <= window.innerHeight - TOOLBAR_GAP ? belowTop : aboveTop);
        const left = rect.left + rect.width / 2 - width / 2;
        return { top: clampTop(top), left: Math.min(Math.max(TOOLBAR_GAP, left), window.innerWidth - width - TOOLBAR_GAP) };
    }

    const inputTop = document.getElementById('send_form')?.getBoundingClientRect().top ?? window.innerHeight;
    return { top: clampTop(inputTop - height - TOOLBAR_GAP), left: (window.innerWidth - width) / 2 };
}

function showToolbar(info) {
    pending = info;
    toolbar.classList.add('stqa_visible');
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const { top, left } = dodgeFloatingElements(computePosition(info.rect, width, height), width, height);
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
        // Only the shown translation changes. No edit/update events: the translate extension
        // treats MESSAGE_UPDATED as "the original changed" and drops or redoes the translation.
        message.extra.display_text = text;
        context.updateMessageBlock(messageId, message);
    } else {
        message.mes = text;
        if (message.swipe_id !== undefined && Array.isArray(message.swipes)) {
            message.swipes[message.swipe_id] = text;
        }
        // Same events as ST's own message edit
        await context.eventSource.emit(context.eventTypes.MESSAGE_EDITED, messageId);
        context.updateMessageBlock(messageId, message);
        await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
    }
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

/**
 * One editable version of the selection: the shown text (translation or original) and, for
 * translated messages, the matching paragraphs of the original.
 */
function buildEditTargets(messageId, field, source, range) {
    const targets = [{ field, source, range, label: field === 'display_text' ? '번역문' : '원문' }];
    if (field === 'display_text') {
        const original = SillyTavern.getContext().chat[messageId].mes;
        targets.push({ field: 'mes', source: original, range: mapToSameParagraphs(source, range, original), label: '원문' });
    }
    for (const target of targets) {
        target.initial = target.source.slice(target.range.start, target.range.end);
        target.text = target.initial;
    }
    return targets;
}

async function editSelection({ messageId, field, source, range }) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const targets = buildEditTargets(messageId, field, source, range);
    let active = 0;

    const header = document.createElement('div');
    header.innerHTML = '<h3>선택한 부분 수정</h3><small class="stqa_hint stqa_edit_mode"></small>';
    const modeLabel = header.querySelector('.stqa_edit_mode');
    const updateModeLabel = () => {
        modeLabel.textContent = targets.length > 1 ? `${targets[active].label} 수정 중` : '';
    };
    updateModeLabel();

    const popup = new Popup(header, POPUP_TYPE.INPUT, targets[0].text, {
        rows: 6,
        okButton: '적용',
        cancelButton: '취소',
        // Translated messages: switch between editing the translation and the original
        customButtons: targets.length > 1 ? [{
            text: '원문 전환',
            icon: 'fa-language',
            action: () => {
                targets[active].text = popup.mainInput.value;
                active = (active + 1) % targets.length;
                popup.mainInput.value = targets[active].text;
                updateModeLabel();
            },
        }] : null,
    });
    const result = await popup.show();
    if (result === null || result === false || result === POPUP_RESULT.CANCELLED) {
        return;
    }
    targets[active].text = popup.mainInput.value;

    // The original first: editing it can make the translator redo the translation
    const ordered = [...targets.filter(target => target.field === 'mes'), ...targets.filter(target => target.field !== 'mes')];
    const chat = SillyTavern.getContext().chat;
    for (const target of ordered) {
        // In manual translate mode, editing the original drops the translation; keep it, since
        // the user was reading the translated message
        const translationDropped = target.field === 'display_text' && !chat[messageId].extra?.display_text;
        if (target.text !== target.initial || translationDropped) {
            const { source: text, range: { start, end } } = target;
            await applySourceText(messageId, target.field, text.slice(0, start) + target.text + text.slice(end));
        }
    }
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
