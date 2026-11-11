// A ··· button on each prompt of the prompt list (next to the pencil). It opens a small menu:
// copy (right below, switched off, "(복사)" after the name), move to the top / bottom of the list,
// and delete for good (asked first; not ST's "remove from the list" chain).
import { MODULE, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const PREFIX = 'completion_';
const BUTTON_CLASS = 'stqa_prompt_more';
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
    const on = isOn('promptCopy');
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
    if (!await Popup.show.confirm(`'${prompt.name ?? ''}' 삭제`, '이 항목을 프롬프트에서 아예 지웁니다. 되돌릴 수 없습니다.')) {
        return;
    }
    const at = pm.serviceSettings.prompts.indexOf(prompt);
    at >= 0 && pm.serviceSettings.prompts.splice(at, 1);
    // Out of every order it is in, not only this list's
    for (const list of pm.serviceSettings.prompt_order ?? []) {
        Array.isArray(list.order) && list.order.splice(0, list.order.length, ...list.order.filter(entry => entry.identifier !== identifier));
    }
    await saveAndDraw();
    toastr.success(`'${prompt.name ?? ''}'을(를) 지웠습니다.`, TITLE);
}

/* ---------- the menu ---------- */

let menu = null;
let menuOwner = null;

function closeMenu() {
    menu?.remove();
    menu = null;
    menuOwner = null;
    document.removeEventListener('pointerdown', onOutside, true);
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
    const rows = [
        copyable(prompt) && ['copy', 'fa-copy', '복사 (바로 아래에)'],
        index > 0 && ['top', 'fa-angles-up', '맨 위로'],
        index >= 0 && index < order.length - 1 && ['bottom', 'fa-angles-down', '맨 아래로'],
        pm.isPromptDeletionAllowed(prompt) && ['delete', 'fa-trash-can', '삭제'],
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
}

const ACTIONS = {
    copy: copyPrompt,
    top: identifier => movePrompt(identifier, true),
    bottom: identifier => movePrompt(identifier, false),
    delete: deletePrompt,
};

function onClick(event) {
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
    !isOn('promptCopy') && closeMenu();
}

export function initPromptCopy() {
    const root = document.getElementById(`${PREFIX}prompt_manager`);
    if (!openai || !root) {
        return;
    }
    document.addEventListener('click', onClick, true);
    // The manager draws the whole list anew on every change
    new MutationObserver((records) => {
        if (!onlyOwnChanges(records)) {
            addButtons();
        }
    }).observe(root, { childList: true, subtree: true });
    addButtons();
}
