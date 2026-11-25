// A ··· button on each prompt of the prompt list (next to the pencil). It opens a small menu:
// copy (right below, switched off, "(복사)" after the name), move to the top / bottom of the list,
// and delete for good (asked first; not ST's "remove from the list" chain).
// Also moving by taps: ☰ on a prompt picks it, a tap on another prompt puts it there (no dragging),
// 교체 in the menu and 가져오기 by ✚ (items of another prompt: prompt-import.js).
import { MODULE, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';
import { openImport, openReplace, markFresh } from './prompt-import.js';
import { escapeHtml } from './util.js';

const PREFIX = 'completion_';
const BUTTON_CLASS = 'stqa_prompt_more';
const PICKED_CLASS = 'stqa_prompt_picked';
const IMPORT_ID = 'stqa_prompt_import';
const TITLE = '편의성 모음';

let openai = null;
try {
    openai = await import('../../../openai.js');
} catch (error) {
    console.warn(`[${MODULE}] Prompt manager not available; prompt menu is off`, error);
}

const manager = () => openai?.promptManager ?? null;

function currentOrder() {
    const pm = manager();
    return pm?.activeCharacter ? pm.getPromptOrderForCharacter(pm.activeCharacter) : [];
}

/** Markers (chat history, character description...) have no text of their own to copy. */
const copyable = prompt => Boolean(prompt) && !prompt.marker;

function addButtons() {
    const list = document.getElementById(`${PREFIX}prompt_manager_list`);
    if (!list || !manager()) {
        return;
    }
    markPicked();
    markFresh();
    // ··· holds 교체 too: there while either is on
    const on = isOn('promptCopy') || isOn('promptReplace');
    // 가져오기, right after ✚ (the footer is drawn anew with the list)
    const footer = document.querySelector(`#${PREFIX}prompt_manager .${PREFIX}prompt_manager_footer`);
    const importButton = document.getElementById(IMPORT_ID);
    if (!isOn('promptImport')) {
        importButton?.remove();
    } else if (footer && !importButton) {
        const button = document.createElement('div');
        button.id = IMPORT_ID;
        button.className = 'menu_button fa-solid fa-fw fa-file-arrow-down interactable';
        button.title = '다른 프롬프트 항목 가져오기';
        const add = footer.querySelector('.fa-plus-square');
        add ? add.after(button) : footer.append(button);
    }
    for (const row of list.querySelectorAll(`li.${PREFIX}prompt_manager_prompt[data-pm-identifier]`)) {
        const controls = row.querySelector('.prompt_manager_prompt_controls');
        const old = controls?.querySelector(`.${BUTTON_CLASS}`);
        if (!controls || on === Boolean(old)) {
            continue;
        }
        if (!on) {
            old.remove();
            continue;
        }
        const button = document.createElement('span');
        button.className = `${BUTTON_CLASS} fa-solid fa-ellipsis fa-xs`;
        button.title = '더 보기';
        // Always in front of the pencil's place (ST keeps an empty slot there when there is no
        // pencil), so it lines up from row to row
        const slots = [...controls.children];
        const edit = controls.querySelector('.prompt-manager-edit-action') ?? (slots.length >= 3 ? slots.at(-2) : null);
        edit ? edit.before(button) : controls.prepend(button);
    }
}

/* ---------- actions ---------- */

async function saveAndDraw() {
    const pm = manager();
    pm.render();
    await pm.saveServiceSettings();
}

async function copyPrompt(identifier) {
    const pm = manager();
    const prompt = pm.getPromptById(identifier);
    const order = currentOrder();
    const index = order.findIndex(entry => entry.identifier === identifier);
    if (!copyable(prompt) || index < 0) {
        return;
    }
    const copy = structuredClone(prompt);
    copy.identifier = pm.getUuidv4();
    copy.name = `${prompt.name ?? ''} (복사)`;
    // A copy of ST's own prompt (Main Prompt...) is an ordinary prompt that can be deleted
    copy.system_prompt = false;
    copy.marker = false;
    copy.enabled = false;
    pm.serviceSettings.prompts.push(copy);
    order.splice(index + 1, 0, { identifier: copy.identifier, enabled: false });
    await saveAndDraw();
    toastr.success(`'${copy.name}'을(를) 바로 아래에 만들었습니다.`, TITLE);
}

async function movePrompt(identifier, toTop) {
    const order = currentOrder();
    const index = order.findIndex(entry => entry.identifier === identifier);
    if (index < 0 || index === (toTop ? 0 : order.length - 1)) {
        return;
    }
    const [entry] = order.splice(index, 1);
    toTop ? order.unshift(entry) : order.push(entry);
    await saveAndDraw();
}

async function deletePrompt(identifier) {
    const pm = manager();
    const prompt = pm.getPromptById(identifier);
    if (!prompt || !pm.isPromptDeletionAllowed(prompt)) {
        return;
    }
    const { Popup } = SillyTavern.getContext();
    const preset = openai.oai_settings?.preset_settings_openai;
    if (!await Popup.show.confirm(`'${escapeHtml(prompt.name)}' 삭제`, '이 항목을 프롬프트에서 아예 지웁니다. 되돌릴 수 없습니다.')) {
        return;
    }
    // (Another prompt chosen meanwhile, or the item gone: nothing is deleted)
    if (openai.oai_settings?.preset_settings_openai !== preset || pm.getPromptById(identifier) !== prompt) {
        return;
    }
    const at = pm.serviceSettings.prompts.indexOf(prompt);
    at >= 0 && pm.serviceSettings.prompts.splice(at, 1);
    // Out of every order it is in, not only this list's
    for (const list of pm.serviceSettings.prompt_order ?? []) {
        Array.isArray(list.order) && list.order.splice(0, list.order.length, ...list.order.filter(entry => entry.identifier !== identifier));
    }
    await saveAndDraw();
    toastr.success(`'${escapeHtml(prompt.name)}'을(를) 지웠습니다.`, TITLE);
}

/* ---------- moving by taps ---------- */

let picked = null;
// Where the last press began: a ☰ dragged (ST's own dragging on a PC) is no tap
let pressedAt = null;
const TAP_SLOP = 8;
// A press on ☰ (touch or mouse): a tap is told by the press itself (where it ended, how soon).
// The click that would follow can't be relied on with touch: ST's dragging library drops it as
// soon as the finger trembles a pixel.
let handlePress = null;
let tapTakenAt = 0;
const TAP_MAX_MS = 1000;
const TAP_MOVE = 20;
const rowOf = target => target?.closest?.(`#${PREFIX}prompt_manager_list li.${PREFIX}prompt_manager_prompt_draggable[data-pm-identifier]`);

function togglePick(row) {
    const id = row.dataset.pmIdentifier;
    picked = picked === id ? null : id;
    markPicked();
}

function onPressDown(event) {
    pressedAt = { x: event.clientX, y: event.clientY };
    const row = event.target.closest?.('.drag-handle') && rowOf(event.target);
    handlePress = row && isOn('promptTapMove') ? { id: row.dataset.pmIdentifier, x: event.clientX, y: event.clientY, at: Date.now() } : null;
}

/**
 * The press on ☰ ended (pointer up, or the touch's own end when the browser cancelled the
 * pointer): a tap when it stayed near where it began. The row is found again by its prompt: the
 * list may have been drawn anew meanwhile.
 */
function endPress(x, y) {
    const press = handlePress;
    handlePress = null;
    if (!press || Date.now() - press.at > TAP_MAX_MS || Math.hypot(x - press.x, y - press.y) > TAP_MOVE) {
        return;
    }
    const row = document.querySelector(`#${PREFIX}prompt_manager_list li[data-pm-identifier="${CSS.escape(press.id)}"]`);
    if (!row) {
        return;
    }
    tapTakenAt = Date.now();
    togglePick(row);
}

const onPressUp = event => endPress(event.clientX, event.clientY);

function onTouchEnd(event) {
    const touch = event.changedTouches?.[0];
    touch && endPress(touch.clientX, touch.clientY);
}

function markPicked() {
    for (const row of document.querySelectorAll(`#${PREFIX}prompt_manager_list li[data-pm-identifier]`)) {
        const on = row.dataset.pmIdentifier === picked;
        row.classList.contains(PICKED_CLASS) !== on && row.classList.toggle(PICKED_CLASS, on);
    }
}

function unpick() {
    picked = null;
    markPicked();
}

/** The picked prompt goes to the tapped one's place (below it when it came from above). */
async function placePicked(target) {
    const order = currentOrder();
    const from = order.findIndex(entry => entry.identifier === picked);
    const to = order.findIndex(entry => entry.identifier === target);
    unpick();
    if (from < 0 || to < 0 || from === to) {
        return;
    }
    const [entry] = order.splice(from, 1);
    order.splice(to, 0, entry);
    await saveAndDraw();
}

/** A tap while moving: true when it was taken (not left to ST). */
function onMoveTap(event) {
    if (!isOn('promptTapMove')) {
        picked && unpick();
        return false;
    }
    const row = rowOf(event.target);
    if (event.target.closest?.('.drag-handle') && row) {
        // (The press already took it, or it was a drag)
        if (Date.now() - tapTakenAt < 1000
            || (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > TAP_SLOP)) {
            return true;
        }
        togglePick(row);
        return true;
    }
    if (!picked) {
        return false;
    }
    // A tap on another prompt puts it there; anywhere else lets go of it
    if (row && row.dataset.pmIdentifier !== picked) {
        placePicked(row.dataset.pmIdentifier).catch((error) => {
            console.error(`[${MODULE}] Prompt move failed`, error);
            toastr.error('옮기지 못했습니다.', TITLE);
        });
        return true;
    }
    unpick();
    return Boolean(row);
}

/* ---------- the menu ---------- */

let menu = null;
let menuOwner = null;

function closeMenu() {
    menu?.remove();
    menu = null;
    menuOwner = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', closeMenu);
}

/** The menu doesn't stay where its button was once the list moves. */
function onScroll(event) {
    menu && !menu.contains(event.target) && closeMenu();
}

function onOutside(event) {
    if (menu && !menu.contains(event.target) && !menuOwner?.contains(event.target)) {
        closeMenu();
    }
}

function openMenu(button) {
    const same = menuOwner === button;
    closeMenu();
    if (same) {
        return;
    }
    const pm = manager();
    const identifier = button.closest('[data-pm-identifier]')?.dataset.pmIdentifier;
    const prompt = pm.getPromptById(identifier);
    if (!prompt) {
        return;
    }
    const order = currentOrder();
    const index = order.findIndex(entry => entry.identifier === identifier);
    const menuOn = isOn('promptCopy');
    const rows = [
        menuOn && copyable(prompt) && ['copy', 'fa-copy', '복사 (바로 아래에)'],
        isOn('promptReplace') && copyable(prompt) && ['replace', 'fa-right-left', '다른 프롬프트 항목으로 교체'],
        menuOn && index > 0 && ['top', 'fa-angles-up', '맨 위로'],
        menuOn && index >= 0 && index < order.length - 1 && ['bottom', 'fa-angles-down', '맨 아래로'],
        menuOn && pm.isPromptDeletionAllowed(prompt) && ['delete', 'fa-trash-can', '삭제'],
    ].filter(Boolean);
    if (!rows.length) {
        return;
    }
    menuOwner = button;
    menu = document.createElement('div');
    // ST keeps its side panels open for taps on its own kinds of lists; this is one
    menu.className = 'stqa_tr_menu stqa_prompt_menu list-group select2-results';
    menu.dataset.identifier = identifier;
    for (const [action, icon, label] of rows) {
        const row = document.createElement('div');
        row.className = `list-group-item${action === 'delete' ? ' stqa_danger' : ''}`;
        row.dataset.promptDo = action;
        row.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
        row.querySelector('span').textContent = label;
        menu.append(row);
    }
    document.body.append(menu);
    const box = button.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = box.bottom + height + 4 < window.innerHeight;
    menu.style.top = `${below ? box.bottom + 4 : box.top - height - 4}px`;
    menu.style.left = `${Math.max(4, Math.min(box.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 4))}px`;
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeMenu, { once: true });
}

const ACTIONS = {
    copy: copyPrompt,
    replace: openReplace,
    top: identifier => movePrompt(identifier, true),
    bottom: identifier => movePrompt(identifier, false),
    delete: deletePrompt,
};

function onClick(event) {
    if (event.target.closest?.(`#${IMPORT_ID}`)) {
        event.stopPropagation();
        openImport().catch((error) => {
            console.error(`[${MODULE}] Prompt import failed`, error);
            toastr.error('가져오지 못했습니다.', TITLE);
        });
        return;
    }
    if (onMoveTap(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    const button = event.target.closest?.(`.${BUTTON_CLASS}`);
    if (button) {
        event.stopPropagation();
        openMenu(button);
        return;
    }
    const row = event.target.closest?.('.stqa_prompt_menu [data-prompt-do]');
    if (!row) {
        return;
    }
    event.stopPropagation();
    const identifier = menu.dataset.identifier;
    const action = row.dataset.promptDo;
    closeMenu();
    ACTIONS[action](identifier).catch((error) => {
        console.error(`[${MODULE}] Prompt ${action} failed`, error);
        toastr.error('하지 못했습니다.', TITLE);
    });
}

export function applyPromptCopy() {
    addButtons();
    if (!isOn('promptCopy') && !isOn('promptReplace')) {
        closeMenu();
    }
    !isOn('promptTapMove') && picked && unpick();
    document.body.classList.toggle('stqa_prompt_tapmove_on', isOn('promptTapMove'));
}

export function initPromptCopy() {
    const root = document.getElementById(`${PREFIX}prompt_manager`);
    if (!openai || !root) {
        return;
    }
    document.addEventListener('click', onClick, true);
    document.body.classList.toggle('stqa_prompt_tapmove_on', isOn('promptTapMove'));
    document.addEventListener('pointerdown', onPressDown, true);
    document.addEventListener('pointerup', onPressUp, true);
    // (A cancelled pointer leaves the press to the touch's own end)
    document.addEventListener('touchend', onTouchEnd, true);
    // Another prompt chosen: what was picked or opened was of the one before
    $(document).on('change', '#settings_preset_openai', () => {
        closeMenu();
        picked && unpick();
    });
    // The manager draws the whole list anew on every change (off: its list has nothing of ours)
    new MutationObserver((records) => {
        if ((isOn('promptCopy') || isOn('promptImport') || isOn('promptReplace') || picked) && !onlyOwnChanges(records)) {
            addButtons();
        }
    }).observe(root, { childList: true, subtree: true });
    addButtons();
}
