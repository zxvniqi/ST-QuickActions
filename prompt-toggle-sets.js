// Saved toggle combinations of a prompt preset ("한국어", "짧게", ...), shown as chips above the
// prompt list: tap one to switch the prompts on / off as saved. Kept per preset name.
import { MODULE, getSettings } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const PREFIX = 'completion_';
const PRESET_SELECT = '#settings_preset_openai';
const BAR_CLASS = 'stqa_toggle_sets';
const TITLE = '편의성 모음';

let openai = null;
try {
    openai = await import('../../../openai.js');
} catch (error) {
    console.warn(`[${MODULE}] Prompt manager not available; toggle sets are off`, error);
}

// Showing the × buttons (remove a set) right now
let editing = false;

const manager = () => openai?.promptManager ?? null;
const presetName = () => document.querySelector(PRESET_SELECT)?.selectedOptions[0]?.textContent.trim() ?? '';

function promptOrder() {
    const pm = manager();
    return pm?.activeCharacter ? pm.getPromptOrderForCharacter(pm.activeCharacter) : [];
}

function setsOf(preset) {
    return getSettings().toggleSets[preset] ?? [];
}

function saveSets(preset, list) {
    const all = getSettings().toggleSets;
    list.length ? (all[preset] = list) : delete all[preset];
    SillyTavern.getContext().saveSettingsDebounced();
}

/** A set matches when every prompt it names is on / off as saved. */
function isCurrent(set, order) {
    return order.length > 0 && order.every(entry => !(entry.identifier in set.states) || set.states[entry.identifier] === entry.enabled);
}

async function applySet(set) {
    const pm = manager();
    for (const entry of promptOrder()) {
        if (entry.identifier in set.states) {
            entry.enabled = set.states[entry.identifier];
        }
    }
    // The same as switching them by hand
    await pm.saveServiceSettings();
    pm.render();
    toastr.success(`'${set.name}' 조합으로 바꿨어요.`, TITLE);
}

async function saveCurrent(preset) {
    const { Popup } = SillyTavern.getContext();
    const name = String(await Popup.show.input('지금 토글 조합 저장', '이름 (예: 한국어, 짧게). 같은 이름이면 덮어써요.', '') || '').trim();
    if (!name) {
        return;
    }
    const states = Object.fromEntries(promptOrder().map(entry => [entry.identifier, entry.enabled]));
    saveSets(preset, [...setsOf(preset).filter(set => set.name !== name), { name, states }]);
    drawBar();
}

async function removeSet(preset, set) {
    const { Popup } = SillyTavern.getContext();
    if (await Popup.show.confirm(`'${set.name}' 조합을 지울까요?`, '토글 상태는 그대로예요.')) {
        saveSets(preset, setsOf(preset).filter(item => item !== set));
        drawBar();
    }
}

function chip(className, html, title, onClick) {
    const element = document.createElement('span');
    element.className = `stqa_variant_chip ${className}`;
    element.innerHTML = html;
    element.title = title;
    element.addEventListener('click', (event) => {
        event.stopPropagation();
        Promise.resolve(onClick(event)).catch(error => console.error(`[${MODULE}] Toggle set failed`, error));
    });
    return element;
}

/** The chip bar right above the prompt list. */
function drawBar() {
    const list = document.getElementById(`${PREFIX}prompt_manager_list`);
    if (!manager() || !list) {
        return;
    }
    list.parentElement.querySelector(`:scope > .${BAR_CLASS}`)?.remove();
    const preset = presetName();
    const sets = setsOf(preset);
    const order = promptOrder();
    const bar = document.createElement('div');
    bar.className = `${BAR_CLASS} stqa_variant_chips`;
    bar.title = '토글 조합';
    for (const set of sets) {
        const element = chip(isCurrent(set, order) ? 'stqa_active' : '', '', '이 조합으로 바꾸기', (event) => {
            return event.target.closest('.stqa_variant_remove') ? removeSet(preset, set) : applySet(set);
        });
        element.textContent = set.name;
        if (editing) {
            element.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-xmark stqa_variant_remove" title="이 조합 지우기"></i>');
        }
        bar.append(element);
    }
    bar.append(chip('stqa_variant_add', `<i class="fa-solid fa-plus"></i>${sets.length ? '' : ' 지금 토글 조합 저장'}`, '지금 토글 조합 저장', () => saveCurrent(preset)));
    if (sets.length) {
        bar.append(chip(`stqa_variant_add${editing ? ' stqa_active' : ''}`, '<i class="fa-solid fa-pen"></i>', '조합 지우기 모드', () => {
            editing = !editing;
            drawBar();
        }));
    }
    list.before(bar);
}

export function initToggleSets() {
    const root = document.getElementById(`${PREFIX}prompt_manager`);
    if (!openai || !root) {
        return;
    }
    let timer = null;
    // The manager builds itself anew on every change (a toggle switched by hand included)
    new MutationObserver((records) => {
        if (onlyOwnChanges(records)) {
            return;
        }
        clearTimeout(timer);
        timer = setTimeout(drawBar, 50);
    }).observe(root, { childList: true, subtree: true });
    drawBar();
}
