// "프롬프트 관리": one window for the prompt (preset) list. Every change applies at once (no
// save step): drag ≡ to reorder (the order of the prompt list this extension opens), tick
// prompts to delete them or put them in / take them out of a folder, and make / rename / remove
// folders. Folder chips at the top narrow the list; "전체" shows everything.
import { getSettings } from './settings.js';
import { FOLDER_AREAS, getFolders, saveFolders, listAreaItems } from './folders.js';
import { enableDragging } from './layout-editor.js';

const TITLE = '편의성 모음';
const ALL = '';

const nameOf = option => FOLDER_AREAS.presets.describe(option).key;

function newId() {
    return Math.random().toString(36).slice(2, 10);
}

/** Prompt names in the user's order: ordered ones first, the rest (new ones) after, as the page lists them. */
export function orderedPresetNames() {
    const names = listAreaItems('presets').map(item => item.key);
    const order = getSettings().presetOrder ?? [];
    const rank = new Map(order.map((name, index) => [name, index]));
    return names
        .map((name, index) => ({ name, index }))
        .sort((a, b) => (rank.get(a.name) ?? order.length + a.index) - (rank.get(b.name) ?? order.length + b.index))
        .map(({ name }) => name);
}

function saveOrder(names) {
    getSettings().presetOrder = names;
    SillyTavern.getContext().saveSettingsDebounced();
}

function storeFolders(folders) {
    saveFolders('presets', folders);
}

export async function openPresetManager() {
    const { Popup, POPUP_TYPE, getPresetManager } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.className = 'stqa_preset_manage';
    // Shown folder (ALL: every prompt) and ticked prompts
    let view = ALL;
    const picked = new Set();

    const folders = () => getFolders('presets');
    const folderOf = name => folders().find(folder => folder.keys.includes(name));

    const askName = async (title, value = '') => {
        const name = await Popup.show.input(title, '', value);
        return typeof name === 'string' ? name.trim() : '';
    };

    const removeFromFolders = (names) => {
        storeFolders(folders().map(folder => ({ ...folder, keys: folder.keys.filter(key => !names.includes(key)) })));
    };

    const moveTo = (folderId, names) => {
        storeFolders(folders().map(folder => ({
            ...folder,
            keys: folder.id === folderId
                ? [...folder.keys.filter(key => !names.includes(key)), ...names]
                : folder.keys.filter(key => !names.includes(key)),
        })));
    };

    const deletePicked = async () => {
        const names = [...picked];
        const manager = getPresetManager?.('openai');
        if (!names.length || !manager) {
            return;
        }
        // The window shows its text as HTML: names are escaped
        const escape = text => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
        const shown = names.slice(0, 5).map(escape).join(', ') + (names.length > 5 ? ` 외 ${names.length - 5}개` : '');
        if (!await Popup.show.confirm(`프롬프트 ${names.length}개 삭제`, `${shown}<br>되돌릴 수 없습니다.`)) {
            return;
        }
        let failed = 0;
        for (const name of names) {
            try {
                if (!await manager.deletePreset(name)) {
                    failed++;
                }
            } catch (error) {
                console.error(`[${TITLE}] Deleting a prompt failed`, error);
                failed++;
            }
        }
        removeFromFolders(names);
        saveOrder((getSettings().presetOrder ?? []).filter(name => !names.includes(name)));
        picked.clear();
        failed ? toastr.error(`${failed}개를 지우지 못했습니다.`, TITLE) : toastr.success(`${names.length}개 삭제했습니다.`, TITLE);
        render();
    };

    const renderChips = (box) => {
        const chip = (id, label, count) => {
            const element = document.createElement('div');
            element.className = `stqa_folder_tab${view === id ? ' stqa_active' : ''}`;
            element.innerHTML = `${id === ALL ? '' : '<i class="fa-solid fa-folder"></i>'}<span></span><small></small>`;
            element.querySelector('span').textContent = label;
            element.querySelector('small').textContent = count;
            element.addEventListener('click', () => {
                view = id;
                render();
            });
            return element;
        };
        box.append(chip(ALL, '전체', orderedPresetNames().length));
        for (const folder of folders()) {
            box.append(chip(folder.id, folder.name, folder.keys.length));
        }
        const add = document.createElement('div');
        add.className = 'stqa_folder_tab stqa_folder_add';
        add.innerHTML = '<i class="fa-solid fa-plus"></i><span>새 폴더</span>';
        add.addEventListener('click', async () => {
            const name = await askName('새 폴더');
            if (name) {
                const folder = { id: newId(), name, keys: [] };
                storeFolders([...folders(), folder]);
                // Ticked prompts go straight into the new folder
                if (picked.size) {
                    moveTo(folder.id, [...picked]);
                    picked.clear();
                }
                view = folder.id;
                render();
            }
        });
        box.append(add);
    };

    /** The folder shown: rename it or remove it (its prompts stay). */
    const renderFolderBar = (box) => {
        const folder = folders().find(item => item.id === view);
        if (!folder) {
            box.remove();
            return;
        }
        box.innerHTML = `
            <div class="menu_button" data-do="rename"><i class="fa-solid fa-pen"></i><span>이름 바꾸기</span></div>
            <div class="menu_button" data-do="remove"><i class="fa-solid fa-folder-minus"></i><span>폴더 삭제</span></div>`;
        box.addEventListener('click', async (event) => {
            const action = event.target.closest('[data-do]')?.dataset.do;
            if (action === 'rename') {
                const name = await askName('폴더 이름', folder.name);
                if (name) {
                    storeFolders(folders().map(item => (item.id === folder.id ? { ...item, name } : item)));
                    render();
                }
            } else if (action === 'remove') {
                storeFolders(folders().filter(item => item.id !== folder.id));
                view = ALL;
                render();
            }
        });
    };

    /** What to do with the ticked prompts. */
    const renderActions = (box) => {
        const count = picked.size;
        box.innerHTML = `
            <span class="stqa_manage_count"></span>
            <select class="text_pole stqa_manage_move"></select>
            <div class="menu_button stqa_danger" data-do="delete"><i class="fa-solid fa-trash-can"></i><span>삭제</span></div>`;
        box.querySelector('.stqa_manage_count').textContent = count ? `${count}개 선택` : '선택 없음';
        const move = box.querySelector('select');
        move.append(new Option('폴더로 옮기기…', ''), new Option('폴더에서 빼기', '-'), ...folders().map(folder => new Option(`📁 ${folder.name}`, folder.id)));
        move.disabled = count === 0;
        box.querySelector('[data-do="delete"]').classList.toggle('disabled', count === 0);
        move.addEventListener('change', () => {
            const names = [...picked];
            move.value === '-' ? removeFromFolders(names) : move.value && moveTo(move.value, names);
            picked.clear();
            render();
        });
        box.querySelector('[data-do="delete"]').addEventListener('click', () => count && deletePicked());
    };

    const renderList = (list) => {
        const all = orderedPresetNames();
        const shown = view === ALL ? all : all.filter(name => folderOf(name)?.id === view);
        if (!shown.length) {
            list.innerHTML = `<div class="stqa_hint">${view === ALL ? '프롬프트가 없습니다.' : '이 폴더는 비어 있습니다. "전체"에서 프롬프트를 체크한 뒤 이 폴더로 옮깁니다.'}</div>`;
            return;
        }
        for (const name of shown) {
            const row = document.createElement('div');
            row.className = `stqa_layout_row stqa_manage_row${picked.has(name) ? ' stqa_picked' : ''}`;
            row.dataset.key = name;
            row.innerHTML = '<div class="stqa_layout_handle fa-solid fa-grip-lines" title="끌어서 순서 바꾸기"></div><i class="fa-regular stqa_manage_check"></i><span class="stqa_layout_label"></span><small class="stqa_folder_item_owner"></small>';
            row.querySelector('.stqa_manage_check').classList.add(picked.has(name) ? 'fa-square-check' : 'fa-square');
            row.querySelector('.stqa_layout_label').textContent = name;
            const owner = folderOf(name);
            if (owner && view === ALL) {
                row.querySelector('small').textContent = owner.name;
            }
            row.addEventListener('click', (event) => {
                if (event.target.closest('.stqa_layout_handle')) {
                    return;
                }
                picked.has(name) ? picked.delete(name) : picked.add(name);
                render();
            });
            list.append(row);
        }
        enableDragging(list, (keys) => {
            // The shown prompts take the places they had among all, in the new order
            const queue = [...keys];
            const set = new Set(keys);
            saveOrder(orderedPresetNames().map(name => (set.has(name) ? queue.shift() : name)));
        });
    };

    const render = () => {
        const scroller = content.closest('.popup-content');
        const scroll = scroller?.scrollTop ?? 0;
        // Prompts deleted elsewhere drop out of the selection
        const names = new Set(orderedPresetNames());
        [...picked].filter(name => !names.has(name)).forEach(name => picked.delete(name));
        if (view !== ALL && !folders().some(folder => folder.id === view)) {
            view = ALL;
        }
        content.innerHTML = `
            <h3>프롬프트 관리</h3>
            <div class="stqa_hint">바꾸는 즉시 적용됩니다. ≡ 를 끌어서 순서를 바꾸고, 항목을 눌러 체크한 뒤 아래에서 폴더로 옮기거나 삭제합니다.</div>
            <div class="stqa_folder_tabs"></div>
            <div class="stqa_manage_folderbar"></div>
            <div class="stqa_manage_actions"></div>
            <div class="stqa_layout_list stqa_manage_list"></div>`;
        renderChips(content.querySelector('.stqa_folder_tabs'));
        renderFolderBar(content.querySelector('.stqa_manage_folderbar'));
        renderActions(content.querySelector('.stqa_manage_actions'));
        renderList(content.querySelector('.stqa_manage_list'));
        if (scroller) {
            scroller.scrollTop = scroll;
        }
    };
    render();
    await new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true }).show();
}
