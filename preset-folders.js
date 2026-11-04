// Folders where the lists are: the prompt (preset) dropdown itself opens a picker where folders
// fold (tap a prompt to use it; folders are edited from there), and the regex panel gets a
// folder button.
import { isOn } from './settings.js';
import { FOLDER_AREAS, getFolders, listAreaItems } from './folders.js';
import { openFolderEditor } from './folder-editor.js';

const PRESET_SELECT = '#settings_preset_openai';
const DISPLAY_ID = 'stqa_preset_display';
const PICKER_ON_CLASS = 'stqa_preset_picker_on';
const REGEX_BUTTON_ID = 'stqa_regex_folders';

function presetRow(name, current, onPick) {
    const row = document.createElement('div');
    row.className = `stqa_picker_item${name === current ? ' stqa_active' : ''}`;
    row.textContent = name;
    row.addEventListener('click', () => onPick(name));
    return row;
}

/** A folder (or the presets in none): a header that folds, and its presets. */
function pickerGroup(title, names, current, open, onPick) {
    const group = document.createElement('div');
    group.className = `stqa_picker_group${open ? '' : ' stqa_folded'}`;
    const header = document.createElement('div');
    header.className = 'stqa_picker_header';
    header.innerHTML = '<i class="fa-solid fa-folder"></i><span></span><small></small><i class="fa-solid fa-chevron-down stqa_folder_caret"></i>';
    header.querySelector('span').textContent = title;
    header.querySelector('small').textContent = `${names.length}`;
    header.addEventListener('click', () => group.classList.toggle('stqa_folded'));
    const body = document.createElement('div');
    body.className = 'stqa_picker_body';
    names.forEach(name => body.append(presetRow(name, current, onPick)));
    group.append(header, body);
    return group;
}

async function openPresetPicker() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const select = document.querySelector(PRESET_SELECT);
    if (!select) {
        return;
    }
    const content = document.createElement('div');
    content.className = 'stqa_preset_picker';
    let popup = null;

    const pick = (name) => {
        const option = [...select.options].find(item => FOLDER_AREAS.presets.describe(item).key === name);
        if (option) {
            select.value = option.value;
            $(select).trigger('change');
        }
        popup?.completeAffirmative();
    };
    const render = () => {
        const names = listAreaItems('presets').map(item => item.key);
        const current = select.selectedOptions[0] ? FOLDER_AREAS.presets.describe(select.selectedOptions[0]).key : '';
        const folders = getFolders('presets');
        const filed = new Set(folders.flatMap(folder => folder.keys));
        content.replaceChildren();
        const head = document.createElement('div');
        head.className = 'stqa_picker_head';
        head.innerHTML = '<h3>프롬프트 고르기</h3><div class="menu_button stqa_picker_edit"><i class="fa-solid fa-folder-tree"></i><span>폴더 편집</span></div>';
        head.querySelector('.stqa_picker_edit').addEventListener('click', async () => {
            await openFolderEditor('presets');
            render();
        });
        content.append(head);
        for (const folder of folders) {
            const members = names.filter(name => folder.keys.includes(name));
            if (members.length) {
                // The folder holding the preset in use starts open
                content.append(pickerGroup(folder.name, members, current, members.includes(current), pick));
            }
        }
        const rest = names.filter(name => !filed.has(name));
        if (rest.length) {
            const others = pickerGroup(folders.length ? '폴더 없음' : '전체', rest, current, !folders.length || rest.includes(current), pick);
            content.append(others);
        }
    };
    render();
    popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true });
    await popup.show();
}

function addButton(id, parent, build, first) {
    if (!parent || document.getElementById(id)) {
        return;
    }
    const button = build();
    button.id = id;
    first ? parent.prepend(button) : parent.append(button);
}

/** The box shown in place of the prompt dropdown: the prompt in use; tap it to pick another. */
function syncDisplay() {
    const select = document.querySelector(PRESET_SELECT);
    const display = document.getElementById(DISPLAY_ID);
    if (select && display) {
        display.querySelector('span').textContent = select.selectedOptions[0]?.textContent.trim() ?? '';
    }
}

function addDisplay() {
    const select = document.querySelector(PRESET_SELECT);
    if (!select || document.getElementById(DISPLAY_ID)) {
        return;
    }
    const display = document.createElement('div');
    display.id = DISPLAY_ID;
    display.className = 'text_pole flex1 interactable';
    display.tabIndex = 0;
    display.innerHTML = '<span></span><i class="fa-solid fa-chevron-down"></i>';
    display.addEventListener('click', () => openPresetPicker().then(syncDisplay));
    select.after(display);
    // ST changes the prompt through jQuery, which native listeners don't hear
    $(select).on('change', syncDisplay);
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.SETTINGS_UPDATED, syncDisplay);
    if (eventTypes.OAI_PRESET_CHANGED_AFTER) {
        eventSource.on(eventTypes.OAI_PRESET_CHANGED_AFTER, syncDisplay);
    }
    syncDisplay();
}

/** Puts the buttons in place; the panels may be built after this extension loads. */
export function addFolderButtons() {
    addDisplay();
    const regexTools = document.getElementById('open_regex_editor')?.parentElement;
    addButton(REGEX_BUTTON_ID, regexTools, () => {
        const button = document.createElement('div');
        button.className = 'menu_button menu_button_icon interactable';
        button.title = '정규식 폴더 정리';
        button.tabIndex = 0;
        button.innerHTML = '<i class="fa-solid fa-folder-tree"></i><small>폴더</small>';
        button.addEventListener('click', () => openFolderEditor('regex'));
        return button;
    });
    applyFolderButtons();
}

/** Shows the buttons of the folder kinds switched on. */
export function applyFolderButtons() {
    const regex = document.getElementById(REGEX_BUTTON_ID);
    document.body.classList.toggle(PICKER_ON_CLASS, isOn('presetFolders'));
    syncDisplay();
    if (regex) {
        regex.hidden = !isOn('regexFolders');
    }
}

export function initPresetFolders() {
    addFolderButtons();
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, addFolderButtons);
}
