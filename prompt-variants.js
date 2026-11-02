// Saved versions of a prompt (e.g. one per language), shown as chips: on the prompt's row in
// the prompt manager (tap to switch the prompt to that version) and in its edit form (tap to
// load it into the text box; versions are saved and removed there).
import { MODULE, getSettings } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const PREFIX = 'completion_';
const TITLE = '편의성 모음';

let openai = null;
try {
    openai = await import('../../../openai.js');
} catch (error) {
    console.warn(`[${MODULE}] Prompt manager not available; prompt versions are off`, error);
}

// The prompt open in the edit form
let editing = null;

const manager = () => openai?.promptManager ?? null;

function variantsOf(identifier) {
    return getSettings().promptVariants[identifier] ?? [];
}

function setVariants(identifier, list) {
    const all = getSettings().promptVariants;
    list.length ? (all[identifier] = list) : delete all[identifier];
    SillyTavern.getContext().saveSettingsDebounced();
}

function chip(text, active) {
    const element = document.createElement('span');
    element.className = `stqa_variant_chip${active ? ' stqa_active' : ''}`;
    element.textContent = text;
    return element;
}

/** Switches a prompt to a saved version and saves the preset. */
async function useVariant(identifier, variant) {
    const pm = manager();
    const prompt = pm?.getPromptById(identifier);
    if (!prompt) {
        return;
    }
    prompt.content = variant.content;
    await pm.saveServiceSettings();
    pm.render();
    toastr.success(`'${prompt.name}' → ${variant.name}`, TITLE);
}

/** Chips under each prompt name in the list, for prompts with saved versions. */
function decorateRows() {
    const pm = manager();
    const list = document.getElementById(`${PREFIX}prompt_manager_list`);
    if (!pm || !list) {
        return;
    }
    for (const row of list.querySelectorAll('li[data-pm-identifier]')) {
        row.querySelector('.stqa_variant_chips')?.remove();
        const identifier = row.dataset.pmIdentifier;
        const variants = variantsOf(identifier);
        const content = pm.getPromptById(identifier)?.content ?? '';
        if (variants.length === 0) {
            continue;
        }
        const chips = document.createElement('div');
        chips.className = 'stqa_variant_chips';
        for (const variant of variants) {
            const element = chip(variant.name, variant.content === content);
            element.title = '이 버전으로 바꾸기';
            element.addEventListener('click', (event) => {
                event.stopPropagation();
                useVariant(identifier, variant).catch(error => console.error(`[${MODULE}] Prompt version failed`, error));
            });
            chips.append(element);
        }
        row.querySelector(`.${PREFIX}prompt_manager_prompt_name`)?.append(chips);
    }
}

/** The versions block in the edit form, below the prompt text. */
function decorateEditForm() {
    const field = document.getElementById(`${PREFIX}prompt_manager_popup_entry_form_prompt`);
    if (!field || !editing) {
        return;
    }
    let block = document.getElementById('stqa_variant_editor');
    if (!block) {
        block = document.createElement('div');
        block.id = 'stqa_variant_editor';
        block.className = 'stqa_variant_editor';
        field.after(block);
    }
    const identifier = editing;
    block.innerHTML = '<small>저장한 버전 (누르면 위 칸에 불러와요. 저장은 원래 저장 버튼으로)</small><div class="stqa_variant_chips"></div>';
    const chips = block.querySelector('.stqa_variant_chips');
    const variants = variantsOf(identifier);
    for (const variant of variants) {
        const element = chip(variant.name, variant.content === field.value);
        const remove = document.createElement('i');
        remove.className = 'fa-solid fa-xmark stqa_variant_remove';
        remove.title = '이 버전 지우기';
        element.append(remove);
        element.addEventListener('click', async (event) => {
            if (event.target === remove) {
                const { Popup } = SillyTavern.getContext();
                if (await Popup.show.confirm(`'${variant.name}' 버전을 지울까요?`, '프롬프트 내용은 그대로예요.')) {
                    setVariants(identifier, variantsOf(identifier).filter(item => item !== variant));
                    decorateEditForm();
                    decorateRows();
                }
                return;
            }
            field.value = variant.content;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            decorateEditForm();
        });
        chips.append(element);
    }
    const save = document.createElement('span');
    save.className = 'stqa_variant_chip stqa_variant_add';
    save.innerHTML = '<i class="fa-solid fa-plus"></i> 지금 내용을 버전으로 저장';
    save.addEventListener('click', async () => {
        const { Popup } = SillyTavern.getContext();
        const name = String(await Popup.show.input('버전 이름', '예: 한국어, 영어, 짧게', '') || '').trim();
        if (!name) {
            return;
        }
        const others = variantsOf(identifier).filter(item => item.name !== name);
        setVariants(identifier, [...others, { name, content: field.value }]);
        decorateEditForm();
        decorateRows();
    });
    chips.append(save);
}

export function initPromptVariants() {
    const pm = manager();
    const root = document.getElementById(`${PREFIX}prompt_manager`);
    if (!openai || !root) {
        return;
    }
    // Which prompt the edit form shows (the form itself doesn't say)
    const patch = (instance) => {
        if (!instance || instance.stqaVariantsPatched) {
            return;
        }
        instance.stqaVariantsPatched = true;
        const load = instance.loadPromptIntoEditForm;
        instance.loadPromptIntoEditForm = function (prompt) {
            const result = load.call(this, prompt);
            editing = prompt?.identifier ?? null;
            decorateEditForm();
            return result;
        };
    };
    patch(pm);
    let timer = null;
    // The manager builds itself anew on every change, list items a moment after the frame
    new MutationObserver((records) => {
        if (onlyOwnChanges(records)) {
            return;
        }
        patch(manager());
        clearTimeout(timer);
        timer = setTimeout(decorateRows, 50);
    }).observe(root, { childList: true, subtree: true });
    decorateRows();
}
