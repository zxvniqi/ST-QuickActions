// Folders for long lists: regex scripts and prompt presets. Regex scripts run in list order: a
// folder's scripts are kept next to each other, its row sits before the first one, folding hides
// them, and the row's ≡ drags the folder as a block. Presets are a dropdown and stay untouched:
// their folders show in the list it opens (preset-folders.js).
import { MODULE, getSettings, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const FOLDER_CLASS = 'stqa_folder';
const MEMBER_ATTR = 'data-stqa-folder';
const FOLDED_CLASS = 'stqa_folded';

export const FOLDER_AREAS = Object.freeze({

    regex: {
        title: '정규식',
        containers: ['#saved_regex_scripts', '#saved_scoped_scripts', '#saved_preset_scripts'],
        items: container => [...container.querySelectorAll(':scope > .regex-script-label[id]')],
        describe: item => ({ key: item.id, label: item.querySelector('.regex_script_name')?.textContent.trim() || item.id }),
    },
    presets: {
        title: '프롬프트',
        containers: ['#settings_preset_openai'],
        // Nothing is drawn into the dropdown itself
        listOnly: true,
        items: select => [...select.querySelectorAll('option')],
        // Presets are known by name (the option values are list positions)
        describe: option => ({ key: option.textContent.trim(), label: option.textContent.trim() }),
    },
});

// Folders unfolded right now (not saved: everything starts folded)
const unfolded = new Set();

export function getFolders(area) {
    const folders = getSettings().folders;
    folders[area] ??= [];
    return folders[area];
}

// The setting that switches each kind of folder on / off
const AREA_SETTING = Object.freeze({ regex: 'regexFolders', presets: 'presetFolders' });

/** The folders to show: none while that kind of folder is switched off (they stay saved). */
function shownFolders(area) {
    return isOn(AREA_SETTING[area]) ? getFolders(area) : [];
}

export function saveFolders(area, list) {
    getSettings().folders[area] = list;
    SillyTavern.getContext().saveSettingsDebounced();
    applyFolders(area);
}

/** Items of an area as they are now: element, key, label (for the folder editor). */
export function listAreaItems(area) {
    const config = FOLDER_AREAS[area];
    const items = [];
    for (const selector of config.containers) {
        const container = document.querySelector(selector);
        if (!container) {
            continue;
        }
        for (const element of config.items(container)) {
            items.push({ element, ...config.describe(element) });
        }
    }
    return items;
}

function folderRow(area, folder, tag) {
    const row = document.createElement(tag);
    row.className = `${FOLDER_CLASS}_header`;
    row.dataset.folderId = folder.id;
    // ≡ moves the folder as a block, like the scripts' own handle
    row.innerHTML = '<i class="fa-solid fa-bars stqa_folder_drag" title="끌어서 폴더째 순서 바꾸기"></i><span class="stqa_folder_name"></span><small class="stqa_folder_note"></small><i class="fa-solid fa-chevron-down stqa_folder_caret"></i>';
    row.querySelector('.stqa_folder_name').textContent = folder.name;
    row.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.target.closest('.stqa_folder_drag')) {
            return;
        }
        unfolded.has(folder.id) ? unfolded.delete(folder.id) : unfolded.add(folder.id);
        applyFolders(area);
    });
    return row;
}

/** Regex scripts: a folder row before the first item; folding hides the items. */
function applyMarkingFolders(area, container) {
    const config = FOLDER_AREAS[area];
    const folders = shownFolders(area);
    const items = config.items(container);
    const folderOf = new Map(folders.flatMap(folder => folder.keys.map(key => [key, folder])));
    container.querySelectorAll(`:scope > .${FOLDER_CLASS}_header`).forEach(row => row.remove());
    const firstOf = new Map();
    for (const item of items) {
        const { key } = config.describe(item);
        const folder = folderOf.get(key);
        folder ? item.setAttribute(MEMBER_ATTR, folder.id) : item.removeAttribute(MEMBER_ATTR);
        item.classList.toggle(FOLDED_CLASS, Boolean(folder) && !unfolded.has(folder.id));
        if (folder && !firstOf.has(folder.id)) {
            firstOf.set(folder.id, item);
        }
    }
    for (const folder of folders) {
        const first = firstOf.get(folder.id);
        if (!first) {
            continue;
        }
        const row = folderRow(area, folder, first.tagName === 'LI' ? 'li' : 'div');
        row.classList.toggle(FOLDED_CLASS, !unfolded.has(folder.id));
        const members = items.filter(item => folder.keys.includes(config.describe(item).key));
        row.querySelector('.stqa_folder_note').textContent = `${members.length}개`;
        first.before(row);
    }
    enableBlockDrag(area, container);
}

/**
 * Saves the order the scripts are in on the page, the way the regex panel does after its own
 * drag (its sortable's stop handler reads the page order, saves it and redraws the list).
 */
async function saveListOrder(container) {
    let stop = null;
    try {
        stop = $(container).sortable('option', 'stop');
    } catch {
        // Not a sortable list (yet)
    }
    if (typeof stop === 'function') {
        await stop.call(container);
    }
}

/** Moves each folder's scripts together, right after its first one. Returns whether anything moved. */
function gatherMembers(area, container) {
    const config = FOLDER_AREAS[area];
    let moved = false;
    for (const folder of getFolders(area)) {
        const items = config.items(container);
        const members = items.filter(item => folder.keys.includes(config.describe(item).key));
        const start = items.indexOf(members[0]);
        if (members.every((item, index) => items[start + index] === item)) {
            continue;
        }
        let last = members[0];
        for (const item of members.slice(1)) {
            last.after(item);
            last = item;
        }
        moved = true;
    }
    return moved;
}

/** Puts the scripts of each regex folder next to each other (their run order changes to match) and saves. */
export async function gatherFolderItems(area) {
    const config = FOLDER_AREAS[area];
    if (config.listOnly) {
        return;
    }
    for (const selector of config.containers) {
        const container = document.querySelector(selector);
        if (container && gatherMembers(area, container)) {
            await saveListOrder(container);
        }
    }
    applyFolders(area);
}

// A folder being dragged: the list is left alone until it is dropped
let draggingBlock = false;

/** The nearest box that scrolls, for scrolling while a folder is dragged near its edge. */
function scrollerOf(element) {
    for (let node = element.parentElement; node; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
            return node;
        }
    }
    return document.scrollingElement;
}

/** Dragging a folder row (≡) moves the folder and its scripts together, then saves the new order. */
function enableBlockDrag(area, container) {
    if (container.dataset.stqaBlockDrag) {
        return;
    }
    container.dataset.stqaBlockDrag = '1';
    container.addEventListener('pointerdown', (event) => {
        const handle = event.target.closest('.stqa_folder_drag');
        if (!handle || event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const header = handle.closest(`.${FOLDER_CLASS}_header`);
        const block = [header, ...container.querySelectorAll(`:scope > [${MEMBER_ATTR}="${CSS.escape(header.dataset.folderId)}"]`)];
        const scroller = scrollerOf(container);
        const startOrder = [...container.children];
        draggingBlock = true;
        header.classList.add('stqa_dragging');

        const onMove = (move) => {
            const box = scroller.getBoundingClientRect();
            if (move.clientY < box.top + 40) {
                scroller.scrollTop -= 10;
            } else if (move.clientY > box.bottom - 40) {
                scroller.scrollTop += 10;
            }
            // Drop spots: before another folder or a script in no folder, never inside a folder
            const spots = [...container.children].filter(row => !block.includes(row) && !row.hasAttribute(MEMBER_ATTR));
            const next = spots.find(row => move.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
            for (const element of block) {
                next ? container.insertBefore(element, next) : container.append(element);
            }
        };
        const onEnd = async () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onEnd);
            document.removeEventListener('pointercancel', onEnd);
            header.classList.remove('stqa_dragging');
            const changed = [...container.children].some((row, index) => row !== startOrder[index]);
            try {
                if (changed) {
                    await saveListOrder(container);
                }
            } catch (error) {
                console.error(`[${MODULE}] Saving the regex order failed`, error);
            } finally {
                draggingBlock = false;
                applyFolders(area);
            }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
    });
}

const applying = new Set();

export function applyFolders(area) {
    const config = FOLDER_AREAS[area];
    applying.add(area);
    try {
        for (const selector of config.containers) {
            const container = document.querySelector(selector);
            if (!container) {
                continue;
            }
            if (!config.listOnly) {
                applyMarkingFolders(area, container);
            }
        }
    } catch (error) {
        console.error(`[${MODULE}] Folders failed (${area})`, error);
    } finally {
        // Our own changes come back as mutations: let them pass first
        setTimeout(() => applying.delete(area));
    }
}

/** Lists are drawn again often (prompts on every change): folders are put back each time. */
function watch(area) {
    const config = FOLDER_AREAS[area];
    let timer = null;
    const observer = new MutationObserver((records) => {
        if (applying.has(area) || draggingBlock || getFolders(area).length === 0 || onlyOwnChanges(records)) {
            return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => applyFolders(area), 50);
    });
    const attach = () => {
        for (const selector of config.containers) {
            const root = document.querySelector(selector);
            if (root && !root.hasAttribute(`data-stqa-watch-${area}`)) {
                root.setAttribute(`data-stqa-watch-${area}`, '');
                observer.observe(root, { childList: true, subtree: Boolean(config.watchSubtree) });
            }
        }
    };
    attach();
    return attach;
}

export function initFolders() {
    // Extensions menu folders of earlier versions
    delete getSettings().folders.wand;
    delete getSettings().wandFolders;
    const attachers = Object.keys(FOLDER_AREAS).filter(area => !FOLDER_AREAS[area].listOnly).map(area => watch(area));
    const refresh = () => {
        attachers.forEach(attach => attach());
        Object.keys(FOLDER_AREAS).forEach(area => getFolders(area).length && applyFolders(area));
    };
    refresh();
    // The prompt list and regex lists may be built (or replaced) later
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, refresh);
    eventSource.on(eventTypes.SETTINGS_UPDATED, refresh);
    eventSource.on(eventTypes.CHAT_CHANGED, refresh);
}
