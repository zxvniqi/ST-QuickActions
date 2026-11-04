// Quick switches of a prompt (preset): saved on / off states of its items ("한국어", "짧게", ...),
// shown as chips above the item list. Tap one to switch the items as saved; in edit mode (✎) a
// tap opens its menu: overwrite with the current states, rename, or remove. Kept per preset name.
import { MODULE, getSettings, isOn } from './settings.js';
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

// Edit mode: a tap on a chip opens its menu instead of applying it
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
    toastr.success(`'${set.name}' 적용했습니다.`, TITLE);
}

const currentStates = () => Object.fromEntries(promptOrder().map(entry => [entry.identifier, entry.enabled]));

async function saveCurrent(preset) {
    const { Popup } = SillyTavern.getContext();
    const name = String(await Popup.show.input('빠른 전환 추가', '지금 켜고 끈 항목 상태를 이 이름으로 저장합니다.', '') || '').trim();
    if (!name) {
        return;
    }
    saveSets(preset, [...setsOf(preset).filter(set => set.name !== name), { name, states: currentStates() }]);
    drawBar();
}

/** Edit mode: what to do with one saved switch. */
async function editSet(preset, set) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.className = 'stqa_set_menu';
    content.innerHTML = `
        <h3></h3>
        <div class="menu_button" data-do="overwrite"><i class="fa-solid fa-floppy-disk"></i><span>지금 상태로 덮어쓰기</span></div>
        <div class="menu_button" data-do="rename"><i class="fa-solid fa-pen"></i><span>이름 바꾸기</span></div>
        <div class="menu_button stqa_danger" data-do="remove"><i class="fa-solid fa-trash-can"></i><span>삭제</span></div>`;
    content.querySelector('h3').textContent = set.name;
    let action = null;
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기' });
    content.addEventListener('click', (event) => {
        action = event.target.closest('[data-do]')?.dataset.do ?? null;
        if (action) {
            popup.completeAffirmative();
        }
    });
    await popup.show();
    const sets = setsOf(preset);
    if (action === 'overwrite') {
        set.states = currentStates();
        toastr.success(`'${set.name}'을(를) 지금 상태로 덮어썼습니다.`, TITLE);
    } else if (action === 'rename') {
        const name = String(await Popup.show.input('이름 바꾸기', '', set.name) || '').trim();
        if (!name || name === set.name) {
            return;
        }
        // A switch already called that is replaced
        sets.splice(0, sets.length, ...sets.filter(item => item === set || item.name !== name));
        set.name = name;
    } else if (action === 'remove') {
        sets.splice(sets.indexOf(set), 1);
    } else {
        return;
    }
    saveSets(preset, sets);
    drawBar();
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
    if (!isOn('toggleSetChips')) {
        return;
    }
    const preset = presetName();
    const sets = setsOf(preset);
    const order = promptOrder();
    const bar = document.createElement('div');
    bar.className = `${BAR_CLASS} stqa_variant_chips`;
    bar.title = '빠른 전환';
    bar.classList.toggle('stqa_editing', editing);
    for (const set of sets) {
        const element = chip(isCurrent(set, order) ? 'stqa_active' : '', '', editing ? '편집' : '이 상태로 바꾸기', () => (editing ? editSet(preset, set) : applySet(set)));
        element.textContent = set.name;
        bar.append(element);
    }
    bar.append(chip('stqa_variant_add', `<i class="fa-solid fa-plus"></i>${sets.length ? '' : ' 빠른 전환 추가'}`, '지금 상태를 새 빠른 전환으로 저장', () => saveCurrent(preset)));
    if (sets.length) {
        bar.append(chip(`stqa_variant_add${editing ? ' stqa_active' : ''}`, `<i class="fa-solid fa-pen"></i>${editing ? ' 편집 끝내기' : ''}`, '편집: 버튼을 누르면 덮어쓰기·이름 바꾸기·삭제', () => {
            editing = !editing;
            drawBar();
        }));
    }
    list.before(bar);
}

export function applyToggleSets() {
    drawBar();
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
