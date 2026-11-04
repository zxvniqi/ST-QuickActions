// Folders where the lists are. The prompt (preset) dropdown stays as it is; when it opens, a list
// like its own unfolds right under it: folders on top (tap the arrow row to unfold its prompts
// below it), then the prompts in no folder; the last row edits the folders. The regex panel gets
// a folder button.
import { isOn } from './settings.js';
import { FOLDER_AREAS, getFolders, listAreaItems } from './folders.js';
import { openFolderEditor } from './folder-editor.js';

const PRESET_SELECT = '#settings_preset_openai';
const LIST_ID = 'stqa_preset_list';
const REGEX_BUTTON_ID = 'stqa_regex_folders';
const GAP = 2;

let list = null;
// Folders unfolded in the list (the one holding the prompt in use opens by itself)
const unfoldedFolders = new Set();

const nameOf = option => FOLDER_AREAS.presets.describe(option).key;

function closeList() {
    list?.remove();
    list = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', closeList);
}

const isOnSelect = (event, select) => {
    const box = select.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
};

/** A tap elsewhere closes the list (a tap on the dropdown itself toggles it, on click). */
function onOutside(event) {
    const select = document.querySelector(PRESET_SELECT);
    if (list && !list.contains(event.target) && !(select && isOnSelect(event, select))) {
        closeList();
    }
}

function pick(select, name) {
    const option = [...select.options].find(item => nameOf(item) === name);
    if (option && option !== select.selectedOptions[0]) {
        select.value = option.value;
        $(select).trigger('change');
    }
    closeList();
}

function itemRow(select, name, current, nested) {
    const row = document.createElement('div');
    row.className = `stqa_preset_item${name === current ? ' stqa_active' : ''}${nested ? ' stqa_nested' : ''}`;
    row.textContent = name;
    row.addEventListener('click', () => pick(select, name));
    return row;
}

function renderList(select) {
    const names = listAreaItems('presets').map(item => item.key);
    const current = select.selectedOptions[0] ? nameOf(select.selectedOptions[0]) : '';
    const folders = getFolders('presets');
    const filed = new Set(folders.flatMap(folder => folder.keys));
    const rows = [];
    for (const folder of folders) {
        const members = names.filter(name => folder.keys.includes(name));
        if (!members.length) {
            continue;
        }
        const open = unfoldedFolders.has(folder.id);
        const head = document.createElement('div');
        head.className = `stqa_preset_folder${open ? ' stqa_open' : ''}${members.includes(current) ? ' stqa_holds_current' : ''}`;
        head.innerHTML = '<i class="fa-solid fa-chevron-right"></i><span></span><small></small>';
        head.querySelector('span').textContent = folder.name;
        head.querySelector('small').textContent = members.length;
        head.addEventListener('click', () => {
            open ? unfoldedFolders.delete(folder.id) : unfoldedFolders.add(folder.id);
            renderList(select);
        });
        rows.push(head);
        if (open) {
            rows.push(...members.map(name => itemRow(select, name, current, true)));
        }
    }
    rows.push(...names.filter(name => !filed.has(name)).map(name => itemRow(select, name, current, false)));
    const edit = document.createElement('div');
    edit.className = 'stqa_preset_edit';
    edit.innerHTML = '<i class="fa-solid fa-folder-tree"></i><span>폴더 편집</span>';
    edit.addEventListener('click', async () => {
        closeList();
        await openFolderEditor('presets');
    });
    rows.push(edit);
    const scroll = list.scrollTop;
    list.replaceChildren(...rows);
    list.scrollTop = scroll;
}

/** Puts the list right under the dropdown (above it when there is more room there). */
function placeList(select) {
    const box = select.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP * 4;
    const above = box.top - GAP * 4;
    const up = below < 240 && above > below;
    list.style.left = `${box.left}px`;
    list.style.width = `${box.width}px`;
    list.style.maxHeight = `${Math.max(160, Math.min(up ? above : below, window.innerHeight * 0.6))}px`;
    list.style.top = up ? '' : `${box.bottom + GAP}px`;
    list.style.bottom = up ? `${window.innerHeight - box.top + GAP}px` : '';
}

function openList(select) {
    if (list) {
        closeList();
        return;
    }
    // The folder with the prompt in use starts open
    const current = select.selectedOptions[0] ? nameOf(select.selectedOptions[0]) : '';
    getFolders('presets').filter(folder => folder.keys.includes(current)).forEach(folder => unfoldedFolders.add(folder.id));
    list = document.createElement('div');
    list.id = LIST_ID;
    // ST closes its side panels on a tap outside them, except on a few kinds of lists; this is one
    list.className = 'select2-results';
    document.body.append(list);
    renderList(select);
    placeList(select);
    list.querySelector('.stqa_active')?.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeList);
}

/** The panel under the list scrolled: the list would float away from the dropdown. */
function onScroll(event) {
    if (list && !list.contains(event.target)) {
        closeList();
    }
}

/** The dropdown opens this list instead of its own, while prompt folders are on and there are some. */
function hookSelect() {
    const select = document.querySelector(PRESET_SELECT);
    if (!select || select.dataset.stqaPresetHook) {
        return;
    }
    select.dataset.stqaPresetHook = '1';
    // While on, this list (with its 폴더 편집 row) always stands in for the browser's own. The
    // dropdown takes no taps then (CSS), so they reach the row it sits in: a tap on its spot opens
    // the list. That works the same with any browser, touch or mouse, and scrolling stays free.
    select.parentElement?.addEventListener('click', (event) => {
        if (isOn('presetFolders') && isOnSelect(event, select)) {
            openList(select);
        }
    });
    select.addEventListener('keydown', (event) => {
        if (isOn('presetFolders') &&(event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowDown'))) {
            event.preventDefault();
            openList(select);
        }
    });
    // A prompt changed elsewhere: the open list would be out of date
    $(select).on('change', closeList);
}

function addButton(id, parent, build, first) {
    if (!parent || document.getElementById(id)) {
        return;
    }
    const button = build();
    button.id = id;
    first ? parent.prepend(button) : parent.append(button);
}

/** Puts the buttons in place; the panels may be built after this extension loads. */
export function addFolderButtons() {
    hookSelect();
    const regexTools = document.getElementById('open_regex_editor')?.parentElement;
    addButton(REGEX_BUTTON_ID, regexTools, () => {
        const button = document.createElement('div');
        button.className = 'menu_button menu_button_icon interactable';
        button.title = '정규식 폴더 편집';
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
    if (regex) {
        // menu_button's own display would beat `hidden`
        regex.style.display = isOn('regexFolders') ? '' : 'none';
    }
    document.body.classList.toggle('stqa_preset_list_on', isOn('presetFolders'));
    if (!isOn('presetFolders')) {
        closeList();
    }
}

export function initPresetFolders() {
    addFolderButtons();
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, addFolderButtons);
}
