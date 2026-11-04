// Edit / delete buttons that appear when text inside a message is selected.
import { MODULE, getSettings, isOn } from './settings.js';
import { countOccurrences, locateInSource, expandOverWrappers, removeRange, mapToMatchingPart, wordAt } from './text-locate.js';
import { maskHidden, messageInfo } from './hidden-text.js';
import { rememberTranslation } from './translator-cache.js';

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

/**
 * The nearest fixed/absolute-positioned ancestor that is small enough to be a floating button.
 * Parts of the messages themselves (avatars, swipe arrows) don't count.
 */
function floatingAncestor(element) {
    if (element.closest('#chat')) {
        return null;
    }
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

/** Moves the box past floating elements in one direction; null when it runs into the screen edge. */
function dodgeToward(downward, position, width, height) {
    const fits = top => top >= TOOLBAR_GAP && top + height <= window.innerHeight - TOOLBAR_GAP;
    let { top } = position;
    for (let step = 0; step < MAX_DODGE_STEPS && fits(top); step++) {
        const blocker = findBlocker(top, position.left, width, height);
        if (!blocker) {
            return { top, left: position.left };
        }
        top = downward ? blocker.bottom + TOOLBAR_GAP : blocker.top - height - TOOLBAR_GAP;
    }
    return null;
}

/**
 * Moves the box past floating elements sitting where it would appear: further down in
 * 'below' mode, otherwise up. When there is no room that way it tries the other side of the
 * selection (so the selected text stays visible). If both fail it stays put, drawn on top.
 */
function dodgeFloatingElements(position, width, height, selectionRect) {
    const mode = getSettings().selectionToolbarPosition;
    const downward = mode === 'below';
    const otherSide = mode === 'below'
        ? { top: selectionRect.top - height - TOOLBAR_GAP, left: position.left }
        : mode === 'above' ? { top: selectionRect.bottom + TOOLBAR_GAP, left: position.left } : position;
    return dodgeToward(downward, position, width, height)
        ?? dodgeToward(!downward, otherSide, width, height)
        ?? position;
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
    const { top, left } = dodgeFloatingElements(computePosition(info.rect, width, height), width, height, info.rect);
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
}

function onSelectionChange() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
        if (isBusy) {
            return;
        }
        const info = isOn('selectionTools') ? readSelection() : null;
        info ? showToolbar(info) : hideToolbar();
    }, SELECTION_DEBOUNCE_MS);
}

// Where LLM Translator keeps the translation while it shows the original instead
const BACKUP_FIELD = 'original_translation_backup';

/** The original as translators compare it (macros filled in). */
function comparableOriginal(message) {
    const context = SillyTavern.getContext();
    return context.substituteParams(message.mes, context.name1, message.name);
}

/**
 * Whether the translator shows the original right now ("원문 보기"): it then puts a copy of
 * the original in display_text and keeps the translation in a backup.
 */
function showingOriginal(message) {
    const extra = message.extra;
    return typeof extra?.[BACKUP_FIELD] === 'string' && Boolean(extra.display_text) && extra.display_text === comparableOriginal(message);
}

/** The text on screen comes from: the translation, or the original (also while the translator shows it). */
function getSourceField(message) {
    return message.extra?.display_text && !showingOriginal(message) ? 'display_text' : 'mes';
}

function getSourceText(message, field) {
    return field === 'mes' ? message.mes : message.extra[field];
}

/**
 * Translators may remember which original their translation belongs to (LLM Translator:
 * original_text_for_translation, compared the same way) and drop the translation at the next
 * edit once it differs, and drops it outright when there is none (translations made by older
 * versions). Pointing it at the current original keeps the translation.
 */
function keepTranslationFor(message) {
    if (message.extra?.display_text) {
        message.extra.original_text_for_translation = comparableOriginal(message);
    }
}

/**
 * @param {{ silent?: boolean }} [options] silent: change the original without telling other
 *   extensions (translators then keep the current translation instead of redoing it)
 */
async function applySourceText(messageId, field, text, { silent = false } = {}) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    if (field === BACKUP_FIELD) {
        // The translation waiting while the original is shown: nothing on screen changes
        message.extra[BACKUP_FIELD] = text;
    } else if (field === 'display_text' || silent) {
        // No edit/update events: translate extensions treat them as "the original changed"
        // and drop or redo the translation.
        if (field === 'display_text') {
            message.extra.display_text = text;
            // A backup left over from switching back and forth would bring the old
            // translation back at the next switch
            if (typeof message.extra[BACKUP_FIELD] === 'string') {
                message.extra[BACKUP_FIELD] = text;
            }
        } else {
            const original = showingOriginal(message);
            message.mes = text;
            if (message.swipe_id !== undefined && Array.isArray(message.swipes)) {
                message.swipes[message.swipe_id] = text;
            }
            keepTranslationFor(message);
            // The original on screen is the translator's copy: keep it current
            if (original) {
                message.extra.display_text = comparableOriginal(message);
            }
        }
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
    // A kept (or edited) translation must also be what the translator remembers for this original
    if (message.extra?.display_text && (field !== 'mes' || silent)) {
        await rememberCurrentTranslation(message);
    }
    await context.saveChat();
}

function rememberCurrentTranslation(message) {
    const translation = showingOriginal(message) ? message.extra[BACKUP_FIELD] : message.extra.display_text;
    return rememberTranslation(comparableOriginal(message), translation);
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
        toastr.warning('원문에서 위치를 찾지 못함. 연필 버튼으로 수정', TITLE);
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
        toastr.error('적용 실패', TITLE);
    } finally {
        isBusy = false;
    }
}

/**
 * One editable version of the selection: the shown text (translation or original) and, for
 * translated messages, the matching paragraphs of the original.
 */
function buildEditTargets(messageId, field, source, range) {
    const targets = [{ field, source, range, label: field === 'mes' ? '원문' : '번역문' }];
    const { chat } = SillyTavern.getContext();
    const message = chat[messageId];
    // The other version: the original of a translation, or the translation of the original
    // the translator shows right now
    const other = field === 'display_text' ? { field: 'mes', label: '원문' }
        : showingOriginal(message) ? { field: BACKUP_FIELD, label: '번역문' } : null;
    if (other) {
        const otherSource = getSourceText(message, other.field);
        // Parts the user's regex scripts hide on screen (removed blocks, status cards) are left out
        const info = messageInfo(chat, messageId);
        const otherRange = mapToMatchingPart(maskHidden(source, info), range, maskHidden(otherSource, info));
        targets.push({ ...other, source: otherSource, range: otherRange });
    }
    for (const target of targets) {
        target.initial = target.source.slice(target.range.start, target.range.end);
        target.text = target.initial;
    }
    return targets;
}

/** The original first: changing it (with events) can make the translator redo the translation. */
function originalFirst(targets) {
    return [...targets.filter(target => target.field === 'mes'), ...targets.filter(target => target.field !== 'mes')];
}

async function editSelection({ messageId, field, source, range }) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const targets = buildEditTargets(messageId, field, source, range);
    let active = 0;

    const settings = getSettings();
    const header = document.createElement('div');
    header.innerHTML = `
        <h3>선택한 부분 수정</h3>
        <small class="stqa_hint stqa_edit_mode"></small>`;
    const modeLabel = header.querySelector('.stqa_edit_mode');
    const keepBox = buildKeepTranslationOption(settings);
    keepBox.hidden = true;
    header.append(keepBox);

    let switchButton = null;
    const updateMode = () => {
        const editingOriginal = targets[active].field === 'mes' && targets.length > 1;
        modeLabel.textContent = targets.length > 1 ? `${targets[active].label} 수정 중` : '';
        keepBox.hidden = !editingOriginal;
        if (switchButton) {
            switchButton.innerHTML = `<i class="fa-solid fa-language"></i> ${editingOriginal ? '번역 전환' : '원문 전환'}`;
        }
    };

    const popup = new Popup(header, POPUP_TYPE.INPUT, targets[0].text, {
        rows: 6,
        okButton: '적용',
        cancelButton: '취소',
        // Translated messages: switch between editing the translation and the original
        customButtons: targets.length > 1 ? [{
            text: '원문 전환',
            action: () => {
                targets[active].text = popup.mainInput.value;
                active = (active + 1) % targets.length;
                popup.mainInput.value = targets[active].text;
                updateMode();
            },
        }] : null,
    });
    switchButton = popup.dlg.querySelector('.popup-button-custom');
    updateMode();

    const result = await popup.show();
    if (result === null || result === false || result === POPUP_RESULT.CANCELLED) {
        return;
    }
    targets[active].text = popup.mainInput.value;

    const chat = SillyTavern.getContext().chat;
    const silent = targets.length > 1 && settings.keepTranslation;
    for (const target of originalFirst(targets)) {
        // In manual translate mode, editing the original drops the translation; keep it, since
        // the user was reading the translated message
        const translationDropped = target.field === 'display_text' && !chat[messageId].extra?.display_text;
        if (target.text !== target.initial || translationDropped) {
            const { source: text, range: { start, end } } = target;
            await applySourceText(messageId, target.field, text.slice(0, start) + target.text + text.slice(end), { silent });
        }
    }
}

/** The "번역 유지" option shared by the edit and delete windows (original changed quietly). */
function buildKeepTranslationOption(settings) {
    const box = document.createElement('div');
    box.className = 'stqa_keep_translation';
    box.innerHTML = '<label class="checkbox_label" title="원문만 바꾸고 번역 확장에 알리지 않음"><input type="checkbox"><span>번역 유지</span></label>';
    const input = box.querySelector('input');
    input.checked = settings.keepTranslation;
    input.addEventListener('change', () => {
        settings.keepTranslation = input.checked;
        SillyTavern.getContext().saveSettingsDebounced();
    });
    return box;
}
// A matched original part much longer than the selection means the match wasn't found precisely
const UNSURE_MATCH_MIN = 400;
const UNSURE_MATCH_RATIO = 4;

// Text shown around the part to delete, within its paragraph
const CONTEXT_CHARS = 200;

function contextAround(source, { start, end }) {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = source.indexOf('\n', end);
    return {
        start: Math.max(lineStart, start - CONTEXT_CHARS),
        end: Math.min(lineEnd === -1 ? source.length : lineEnd, end + CONTEXT_CHARS),
    };
}

/** Length of the text in `container` before the given point. */
function offsetWithin(container, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(container);
    range.setEnd(node, offset);
    return range.toString().length;
}

/** Offset in `box`'s text at a tapped point, or null. */
function tappedOffset(box, event) {
    const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.offsetNode ?? range?.startContainer;
    if (!node || !box.contains(node)) {
        return null;
    }
    return offsetWithin(box, node, caret?.offset ?? range.startOffset);
}

/**
 * The part of `target.source` to delete, shown highlighted in its surrounding text. The user
 * can change it by tapping the first word, then the last word (Japanese: character by
 * character); `target.range` is updated in place.
 */
function buildRangePicker(target) {
    const box = document.createElement('div');
    box.className = 'stqa_compare_text stqa_range_box';
    let shown = null;
    let first = null; // the word tapped first, waiting for the last one

    const render = () => {
        shown = contextAround(target.source, target.range);
        const mark = document.createElement('mark');
        mark.className = 'stqa_range_mark';
        mark.classList.toggle('stqa_range_pending', Boolean(first));
        mark.textContent = target.source.slice(target.range.start, target.range.end);
        box.replaceChildren(
            target.source.slice(shown.start, target.range.start),
            mark,
            target.source.slice(target.range.end, shown.end),
        );
    };

    box.addEventListener('click', (event) => {
        const offset = tappedOffset(box, event);
        const word = offset === null ? null : wordAt(target.source, shown.start + offset);
        if (!word) {
            return;
        }
        if (first) {
            target.range = { start: Math.min(first.start, word.start), end: Math.max(first.end, word.end) };
            first = null;
        } else {
            target.range = word;
            first = word;
        }
        render();
    });

    render();
    return box;
}

/**
 * Shows the part to delete before deleting it. Translated messages show the selected
 * translation next to the matching original, and the user picks which of them to delete.
 * @returns {Promise<object[]|null>} the targets to delete from, or null when cancelled
 */
async function confirmDelete(targets) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const translated = targets.length > 1;

    const root = document.createElement('div');
    root.className = 'stqa_delete_confirm';
    root.innerHTML = `
        <h3>선택한 부분 삭제</h3>
        <div class="stqa_compare"></div>
        <small class="stqa_hint">형광펜 부분 삭제. 범위 변경: 첫 단어, 끝 단어 차례로 탭</small>
        <small class="stqa_hint stqa_unsure" hidden></small>`;
    const compare = root.querySelector('.stqa_compare');
    const checks = targets.map((target) => {
        const side = document.createElement('div');
        side.className = 'stqa_compare_side';
        side.innerHTML = `<label class="checkbox_label"><input type="checkbox" checked><b></b></label>`;
        side.querySelector('b').textContent = `${target.label}에서 삭제`;
        // Nothing to choose with a single version
        side.querySelector('label').hidden = !translated;
        side.append(buildRangePicker(target));
        compare.append(side);
        return side.querySelector('input');
    });

    if (translated) {
        // The shown version, and the matching part found in the other one
        const [shown, matched] = targets;
        const unsure = matched.initial.length > Math.max(UNSURE_MATCH_MIN, shown.initial.length * UNSURE_MATCH_RATIO);
        checks[1].checked = !unsure;
        const unsureNote = root.querySelector('.stqa_unsure');
        unsureNote.hidden = !unsure;
        unsureNote.textContent = `⚠️ ${matched.label} 위치가 넓게 잡혀서 ${matched.label} 삭제는 꺼 둠`;

        const keepBox = buildKeepTranslationOption(getSettings());
        root.append(keepBox);
        const originalIndex = targets.findIndex(target => target.field === 'mes');
        const update = () => {
            keepBox.hidden = !checks[originalIndex].checked;
            compare.querySelectorAll('.stqa_compare_side').forEach((side, index) => side.classList.toggle('stqa_off', !checks[index].checked));
        };
        checks.forEach(check => check.addEventListener('change', update));
        update();
    }

    const result = await new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: '삭제', cancelButton: '취소', leftAlign: true }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return null;
    }
    return targets.filter((_, index) => checks[index].checked);
}

/** Puts a message's original and translation back exactly as they were. */
async function restoreMessage(messageId, snapshot) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    message.mes = snapshot.mes;
    if (message.swipe_id !== undefined && Array.isArray(message.swipes)) {
        message.swipes[message.swipe_id] = snapshot.mes;
    }
    if (snapshot.displayText !== undefined) {
        message.extra ??= {};
        message.extra.display_text = snapshot.displayText;
    }
    if (snapshot.translatedFrom !== undefined) {
        message.extra.original_text_for_translation = snapshot.translatedFrom;
    }
    if (snapshot.backup !== undefined) {
        message.extra[BACKUP_FIELD] = snapshot.backup;
    }
    context.updateMessageBlock(messageId, message);
    await context.saveChat();
}

async function deleteSelection({ messageId, field, source, range }) {
    const message = SillyTavern.getContext().chat[messageId];
    const snapshot = {
        mes: message.mes,
        displayText: message.extra?.display_text,
        translatedFrom: message.extra?.original_text_for_translation,
        backup: message.extra?.[BACKUP_FIELD],
    };
    const original = showingOriginal(message);
    const targets = await confirmDelete(buildEditTargets(messageId, field, source, range));
    if (!targets?.length) {
        return;
    }

    // The translation is written back afterwards if changing the original dropped it
    const silent = getSettings().keepTranslation;
    const chat = SillyTavern.getContext().chat;
    for (const target of originalFirst(targets)) {
        const text = removeRange(target.source, expandOverWrappers(target.source, target.range));
        await applySourceText(messageId, target.field, text, { silent: silent && Boolean(snapshot.displayText) });
    }
    // (While the original is shown, display_text is only its copy: nothing to write back)
    if (snapshot.displayText && !original && !chat[messageId].extra?.display_text) {
        await applySourceText(messageId, 'display_text', snapshot.displayText);
    }
    toastr.success('삭제됨. 이 알림을 누르면 되돌리기', TITLE, {
        timeOut: 6000,
        onclick: () => restoreMessage(messageId, snapshot),
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
