// Folders where the lists are. The prompt (preset) dropdown stays as it is; when it opens, a list
// like its own unfolds right under it: folders (tap the arrow row to unfold its prompts below
// it) and the prompts in no folder, in the order set in 프롬프트 관리 (the first row, kept in
// sight while the list scrolls: preset-manage.js, with a search box beside it). Folders opened fold again when the list closes. The regex panel gets a folder button.
import { isOn } from './settings.js';
import { FOLDER_AREAS, getFolders } from './folders.js';
import { openFolderEditor } from './folder-editor.js';
import { openPresetManager, presetEntries } from './preset-manage.js';

const PRESET_SELECT = '#settings_preset_openai';
const LIST_ID = 'stqa_preset_list';
const REGEX_BUTTON_ID = 'stqa_regex_folders';
const GAP = 2;

let list = null;
// The first row (프롬프트 관리 and the search box), made once per opening so typing keeps its focus
let top = null;
let query = '';
const searchable = text => String(text).toLowerCase().replace(/\s+/g, '');
// When the search box was last tapped: a phone's keyboard comes up a moment later (the page
// resizes and scrolls, maybe before the box has its focus), and that must not close the list
let typingAt = 0;
const TYPING_GRACE_MS = 1500;
const typing = () => Boolean(list) && (list.contains(document.activeElement) || Date.now() - typingAt < TYPING_GRACE_MS);

// Folders unfolded while the list is open (the one holding the prompt in use opens by itself)
const unfoldedFolders = new Set();

const nameOf = option => FOLDER_AREAS.presets.describe(option).key;

function closeList() {
    list?.remove();
    list = null;
    top = null;
    query = '';
    unfoldedFolders.clear();
    clearInterval(anchorWatch);
    drawerWatch?.disconnect();
    drawerWatch = null;
    window.removeEventListener('popstate', closeList);
    document.removeEventListener('keydown', onEscape, true);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
}

const isOnSelect = (event, select) => {
    const box = select.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
};

/** A tap elsewhere closes the list (a tap on the dropdown itself toggles it, on click). */
function onOutside(event) {
    const select = document.querySelector(PRESET_SELECT);
    if (!list || list.contains(event.target) || (select && isOnSelect(event, select))) {
        return;
    }
    // A panel's own icon on the top bar closes the panel when the finger lifts (a tap elsewhere
    // closes it as it lands): the list goes at the same moment, not one step before it
    if (event.target.closest?.('#top-settings-holder .drawer-toggle, #top-settings-holder .drawer-icon')) {
        const shown = list;
        const go = () => {
            document.removeEventListener('click', go, true);
            document.removeEventListener('pointercancel', go, true);
            list === shown && closeList();
        };
        document.addEventListener('click', go, true);
        document.addEventListener('pointercancel', go, true);
        setTimeout(go, 1500);
        return;
    }
    closeList();
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
    const current = select.selectedOptions[0] ? nameOf(select.selectedOptions[0]) : '';
    const rows = [];
    // Searching: every prompt whose name has the words, folders or not, in the list's order
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).map(searchable);
    if (words.length) {
        const names = presetEntries().flatMap(({ name, folder, members }) => (folder ? members : [name]));
        const found = names.filter(name => words.every(word => searchable(name).includes(word)));
        rows.push(...found.map(name => itemRow(select, name, current, false)));
        if (!found.length) {
            const none = document.createElement('div');
            none.className = 'stqa_preset_none';
            none.textContent = '없음';
            rows.push(none);
        }
        showRows(rows);
        list.scrollTop = 0;
        return;
    }
    for (const { name, folder, members } of presetEntries()) {
        if (!folder) {
            rows.push(itemRow(select, name, current, false));
            continue;
        }
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
    const scroll = list.scrollTop;
    showRows(rows);
    list.scrollTop = scroll;
}

/**
 * The rows under the first one, put in anew. The first row stays where it is: taken out and put
 * back, its search box would lose its focus (a phone's keyboard sends an input event as it comes
 * up, which draws the list again, and the keyboard would close at once).
 */
function showRows(rows) {
    if (top.parentElement !== list) {
        list.prepend(top);
    }
    while (top.nextSibling) {
        top.nextSibling.remove();
    }
    list.append(...rows);
}

/** 프롬프트 관리 and, beside it, a box to find a prompt by its name. */
function topRow(select) {
    const row = document.createElement('div');
    row.className = 'stqa_preset_top';
    row.innerHTML = '<div class="stqa_preset_edit" title="프롬프트 관리"><i class="fa-solid fa-list-check"></i></div><div class="stqa_preset_search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" class="text_pole" placeholder="찾기"></div>';
    row.querySelector('.stqa_preset_edit').addEventListener('click', () => {
        closeList();
        openPresetManager();
    });
    const input = row.querySelector('input');
    const mark = () => (typingAt = Date.now());
    input.addEventListener('pointerdown', mark);
    input.addEventListener('focus', mark);
    input.addEventListener('input', () => {
        query = input.value;
        renderList(select);
    });
    // Enter picks the only prompt found
    input.addEventListener('keydown', (event) => {
        // (Not the Enter that finishes a Korean syllable)
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            const found = list.querySelectorAll('.stqa_preset_item');
            found.length === 1 && found[0].click();
        }
    });
    return row;
}

/** Typing (a phone's keyboard opening) changes the height: the list stays, put in place again. */
function onResize() {
    if (list && typing()) {
        keepInView();
        return;
    }
    closeList();
}

/**
 * While typing: the keyboard takes the bottom of the screen, and the dropdown may now be under it.
 * The list no longer follows the dropdown; it stays where it is, moved up only as far as needed
 * for its search box and a few rows to show (a search box out of sight loses its focus, which
 * closes the keyboard).
 */
function keepInView() {
    const box = list.getBoundingClientRect();
    const room = window.innerHeight;
    const top = Math.max(8, Math.min(box.top, room - 160));
    list.style.maxHeight = `${Math.max(120, room - top - 8)}px`;
    putAt(box.left, top);
}

/**
 * Puts the list's top left corner at a point of the screen. Measured: some themes move what is
 * "fixed" (a transformed page), so top: 0 is not always the top of the screen.
 */
function putAt(left, top) {
    list.style.bottom = '';
    list.style.left = '0px';
    list.style.top = '0px';
    const origin = list.getBoundingClientRect();
    list.style.left = `${left - origin.left}px`;
    list.style.top = `${top - origin.top}px`;
}

/** Puts the list right under the dropdown (above it when there is more room there). */
function placeList(select) {
    const box = select.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - GAP * 4;
    const above = box.top - GAP * 4;
    const up = below < 240 && above > below;
    list.style.width = `${box.width}px`;
    list.style.maxHeight = `${Math.max(160, Math.min(up ? above : below, window.innerHeight * 0.6))}px`;
    // Above the dropdown: its bottom right on top of it (placed by its top, measured)
    const height = list.getBoundingClientRect().height;
    putAt(box.left, up ? Math.max(4, box.top - GAP - height) : box.bottom + GAP);
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
    top = topRow(select);
    renderList(select);
    placeList(select);
    list.querySelector('.stqa_active')?.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    // The phone's back (or Esc) closes it, and so does its panel closing some other way: the list
    // isn't left floating over what comes up instead
    window.addEventListener('popstate', closeList);
    document.addEventListener('keydown', onEscape, true);
    // Its panel starting to close (ST marks it at once, then slides it away): the list goes with it
    // right then, not once the panel is gone
    const drawer = select.closest('.drawer-content');
    if (drawer) {
        drawerWatch = new MutationObserver(() => {
            (drawer.classList.contains('closedDrawer') || !drawer.classList.contains('openDrawer')) && closeList();
        });
        drawerWatch.observe(drawer, { attributes: true, attributeFilter: ['class'] });
    }
    anchorWatch = setInterval(() => {
        const shown = select.isConnected && (typeof select.checkVisibility === 'function' ? select.checkVisibility() : select.getClientRects().length > 0);
        shown || closeList();
    }, 250);
}

let anchorWatch = null;
let drawerWatch = null;

function onEscape(event) {
    if (event.key === 'Escape' && list) {
        event.stopPropagation();
        closeList();
    }
}

/** The panel under the list scrolled: the list would float away from the dropdown. */
function onScroll(event) {
    // (Not while typing in its search box: a phone's keyboard opening scrolls the page)
    if (list && !list.contains(event.target) && !typing()) {
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
