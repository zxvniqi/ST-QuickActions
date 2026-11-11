// A copy button on each prompt of the prompt list (next to the pencil): the copy goes right
// below the original, switched off, with "(복사)" after its name.
import { MODULE, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const PREFIX = 'completion_';
const BUTTON_CLASS = 'stqa_prompt_copy';
const TITLE = '편의성 모음';

let openai = null;
try {
    openai = await import('../../../openai.js');
} catch (error) {
    console.warn(`[${MODULE}] Prompt manager not available; prompt copy is off`, error);
}

const manager = () => openai?.promptManager ?? null;

/** Markers (chat history, character description...) have no text of their own to copy. */
function copyable(prompt) {
    return Boolean(prompt) && !prompt.marker;
}

function addButtons() {
    const list = document.getElementById(`${PREFIX}prompt_manager_list`);
    const pm = manager();
    if (!list || !pm) {
        return;
    }
    const on = isOn('promptCopy');
    for (const row of list.querySelectorAll(`li.${PREFIX}prompt_manager_prompt[data-pm-identifier]`)) {
        const controls = row.querySelector('.prompt_manager_prompt_controls');
        const old = controls?.querySelector(`.${BUTTON_CLASS}`);
        if (!controls || (on && old)) {
            continue;
        }
        if (!on) {
            old?.remove();
            continue;
        }
        if (!copyable(pm.getPromptById(row.dataset.pmIdentifier))) {
            continue;
        }
        const button = document.createElement('span');
        button.className = `${BUTTON_CLASS} fa-solid fa-copy fa-xs`;
        button.title = '복사 (바로 아래에)';
        const edit = controls.querySelector('.prompt-manager-edit-action');
        edit ? edit.before(button) : controls.prepend(button);
    }
}

async function copyPrompt(identifier) {
    const pm = manager();
    const prompt = pm?.getPromptById(identifier);
    const order = pm?.activeCharacter ? pm.getPromptOrderForCharacter(pm.activeCharacter) : [];
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
    pm.render();
    await pm.saveServiceSettings();
    toastr.success(`'${copy.name}'을(를) 바로 아래에 만들었습니다.`, TITLE);
}

function onClick(event) {
    const button = event.target.closest?.(`.${BUTTON_CLASS}`);
    if (!button) {
        return;
    }
    event.stopPropagation();
    const identifier = button.closest('[data-pm-identifier]')?.dataset.pmIdentifier;
    copyPrompt(identifier).catch((error) => {
        console.error(`[${MODULE}] Prompt copy failed`, error);
        toastr.error('복사하지 못했습니다.', TITLE);
    });
}

export function applyPromptCopy() {
    addButtons();
}

export function initPromptCopy() {
    const root = document.getElementById(`${PREFIX}prompt_manager`);
    if (!openai || !root) {
        return;
    }
    root.addEventListener('click', onClick, true);
    // The manager draws the whole list anew on every change
    new MutationObserver((records) => {
        if (!onlyOwnChanges(records)) {
            addButtons();
        }
    }).observe(root, { childList: true, subtree: true });
    addButtons();
}
