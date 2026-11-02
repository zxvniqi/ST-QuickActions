// Folders for long lists: the wand menu, regex scripts and prompts. A folder shows as one row
// with its name; tap it to unfold its items below.
// The wand menu's order means nothing, so its items are moved into the folder. Regex scripts and
// prompts run in list order, so they stay where they are: their folder row sits at the first
// item, and folding hides the items wherever they are.
import { MODULE, getSettings } from './settings.js';
import { describeItem } from './layout-manager.js';
import { onlyOwnChanges } from './mutations.js';

const FOLDER_CLASS = 'stqa_folder';
const MEMBER_ATTR = 'data-stqa-folder';
const FOLDED_CLASS = 'stqa_folded';

export const FOLDER_AREAS = Object.freeze({
    wand: {
        title: '마법봉 메뉴',
        containers: ['#extensionsMenu'],
        moves: true,
        // Empty slots of extensions that aren't loaded have nothing to put in a folder
        items: container => [...container.children].filter(item => !item.classList.contains(FOLDER_CLASS) && item.textContent.trim()),
        describe: describeItem,
    },
    regex: {
        title: '정규식',
        containers: ['#saved_regex_scripts', '#saved_scoped_scripts', '#saved_preset_scripts'],
        items: container => [...container.querySelectorAll(':scope > .regex-script-label[id]')],
        describe: item => ({ key: item.id, label: item.querySelector('.regex_script_name')?.textContent.trim() || item.id }),
    },
    prompts: {
        title: '프롬프트',
        containers: ['#completion_prompt_manager_list'],
        // The whole prompt manager (list included) is built anew on every change
        watch: '#completion_prompt_manager',
        items: container => [...container.querySelectorAll(':scope > li[data-pm-identifier]')],
        describe: item => ({
            key: item.dataset.pmIdentifier,
            label: item.querySelector('.completion_prompt_manager_prompt_name')?.textContent.trim() || item.dataset.pmIdentifier,
            on: Boolean(item.querySelector('.prompt-manager-toggle-action.fa-toggle-on')),
        }),
    },
});

// Folders unfolded right now (not saved: everything starts folded)
const unfolded = new Set();

export function getFolders(area) {
    const folders = getSettings().folders;
    folders[area] ??= [];
    return folders[area];
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
        const elements = config.items(container);
        // Items already moved into a folder (wand)
        if (config.moves) {
            container.querySelectorAll(`.${FOLDER_CLASS} > .stqa_folder_body > *`).forEach(item => elements.push(item));
        }
        for (const element of elements) {
            items.push({ element, ...config.describe(element) });
        }
    }
    return items;
}

function folderRow(area, folder, tag) {
    const row = document.createElement(tag);
    row.className = `${FOLDER_CLASS}_header`;
    row.dataset.folderId = folder.id;
    row.innerHTML = '<i class="fa-solid fa-folder stqa_folder_icon"></i><span class="stqa_folder_name"></span><small class="stqa_folder_note"></small><i class="fa-solid fa-chevron-down stqa_folder_caret"></i>';
    row.querySelector('.stqa_folder_name').textContent = folder.name;
    row.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        unfolded.has(folder.id) ? unfolded.delete(folder.id) : unfolded.add(folder.id);
        applyFolders(area);
    });
    return row;
}

/** Wand menu: each folder is one menu entry holding its items. */
function applyMovingFolders(area, container) {
    const config = FOLDER_AREAS[area];
    const folders = getFolders(area);
    const byKey = new Map();
    for (const element of [...config.items(container), ...container.querySelectorAll(`.${FOLDER_CLASS} .stqa_folder_body > *`)]) {
        byKey.set(config.describe(element).key, element);
    }
    const kept = new Set(folders.map(folder => folder.id));
    // Folders removed in the editor give their items back
    for (const box of container.querySelectorAll(`:scope > .${FOLDER_CLASS}`)) {
        if (!kept.has(box.dataset.folderId)) {
            box.querySelectorAll('.stqa_folder_body > *').forEach(item => container.append(item));
            box.remove();
        }
    }
    for (const folder of folders) {
        let box = container.querySelector(`:scope > .${FOLDER_CLASS}[data-folder-id="${CSS.escape(folder.id)}"]`);
        if (!box) {
            box = document.createElement('div');
            box.className = FOLDER_CLASS;
            box.id = `stqa_folder_${folder.id}`;
            box.dataset.folderId = folder.id;
            const header = folderRow(area, folder, 'div');
            header.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
            const body = document.createElement('div');
            body.className = 'stqa_folder_body';
            box.append(header, body);
            container.append(box);
        }
        box.querySelector('.stqa_folder_name').textContent = folder.name;
        const body = box.querySelector('.stqa_folder_body');
        // Items taken out of the folder go back to the menu
        for (const item of [...body.children]) {
            if (!folder.keys.includes(config.describe(item).key)) {
                container.append(item);
            }
        }
        for (const key of folder.keys) {
            const item = byKey.get(key);
            if (item && item.parentElement !== body) {
                body.append(item);
            }
        }
        box.classList.toggle(FOLDED_CLASS, !unfolded.has(folder.id));
        box.hidden = body.children.length === 0;
    }
}

/** Regex scripts / prompts: a folder row before the first item; folding hides the items. */
function applyMarkingFolders(area, container) {
    const config = FOLDER_AREAS[area];
    const folders = getFolders(area);
    const items = config.items(container);
    const folderOf = new Map(folders.flatMap(folder => folder.keys.map(key => [key, folder])));
    container.querySelectorAll(`:scope > .${FOLDER_CLASS}_header`).forEach(row => row.remove());
    const firstOf = new Map();
    for (const item of items) {
        const { key } = config.describe(item);
        const folder = folderOf.get(key);
        item.toggleAttribute(MEMBER_ATTR, Boolean(folder));
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
        const members = items.filter(item => folder.keys.includes(config.describe(item).key)).map(config.describe);
        // A folder of prompt versions tells which one is on
        const on = members.filter(member => member.on).map(member => member.label);
        row.querySelector('.stqa_folder_note').textContent = area === 'prompts' && on.length
            ? `켜짐: ${on.join(', ')}`
            : `${members.length}개`;
        first.before(row);
    }
}

const applying = new Set();

export function applyFolders(area) {
    const config = FOLDER_AREAS[area];
    applying.add(area);
    try {
        for (const selector of config.containers) {
            const container = document.querySelector(selector);
            if (container) {
                config.moves ? applyMovingFolders(area, container) : applyMarkingFolders(area, container);
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
        if (applying.has(area) || getFolders(area).length === 0 || onlyOwnChanges(records)) {
            return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => applyFolders(area), 50);
    });
    const attach = () => {
        for (const selector of config.watch ? [config.watch] : config.containers) {
            const root = document.querySelector(selector);
            if (root && !root.hasAttribute(`data-stqa-watch-${area}`)) {
                root.setAttribute(`data-stqa-watch-${area}`, '');
                observer.observe(root, { childList: true, subtree: Boolean(config.watch) });
            }
        }
    };
    attach();
    return attach;
}

export function initFolders() {
    const attachers = Object.keys(FOLDER_AREAS).map(area => watch(area));
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
