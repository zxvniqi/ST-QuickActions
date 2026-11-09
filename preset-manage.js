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

// A folder's place in presetOrder: its id after a mark no prompt name starts with
const FOLDER_MARK = '\u0001';
const folderKey = id => FOLDER_MARK + id;

/**
 * The prompt list from the top, in the user's order: folders (with their prompts, in order)
 * and the prompts in no folder, mixed. Folders not placed yet come first.
 */
export function presetEntries() {
    const names = orderedPresetNames();
    const folders = getFolders('presets');
    const filed = new Set(folders.flatMap(folder => folder.keys));
    const order = getSettings().presetOrder ?? [];
    const rank = new Map(order.map((key, index) => [key, index]));
    return [
        ...folders.map((folder, index) => ({
            key: folderKey(folder.id),
            folder,
            members: names.filter(name => folder.keys.includes(name)),
            at: rank.get(folderKey(folder.id)) ?? index - folders.length,
        })),
        ...names.filter(name => !filed.has(name)).map((name, index) => ({ key: name, name, at: rank.get(name) ?? order.length + index })),
    ].sort((a, b) => a.at - b.at);
}

/** Every place in order: each folder followed by its prompts. */
const sequenceOf = entries => entries.flatMap(entry => (entry.folder ? [entry.key, ...entry.members] : [entry.key]));

function saveOrder(keys) {
    getSettings().presetOrder = keys;
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

    /** A yes / no question with its own button names (text, not markup). */
    const ask = (title, text, okButton) => {
        const box = document.createElement('div');
        box.innerHTML = '<h3></h3><div></div>';
        box.querySelector('h3').textContent = title;
        box.querySelector('div').textContent = text;
        return new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton: '취소' }).show();
    };

    /** Right after a folder is made: every prompt listed to tick the ones that go in. */
    const pickInto = async (folder) => {
        const box = document.createElement('div');
        box.className = 'stqa_folder_editor';
        box.innerHTML = '<h3></h3><div class="stqa_folder_items"></div>';
        box.querySelector('h3').textContent = `${folder.name}에 넣기`;
        const chosen = new Set();
        const owners = new Map(folders().flatMap(other => other.keys.map(key => [key, other.name])));
        for (const name of orderedPresetNames()) {
            const row = document.createElement('div');
            row.className = 'stqa_folder_item';
            row.innerHTML = '<i class="fa-solid fa-square stqa_folder_check"></i><span class="stqa_folder_item_label"></span><small class="stqa_folder_item_owner"></small>';
            row.querySelector('.stqa_folder_item_label').textContent = name;
            row.querySelector('.stqa_folder_item_owner').textContent = owners.get(name) ?? '';
            row.addEventListener('click', () => {
                chosen.has(name) ? chosen.delete(name) : chosen.add(name);
                row.classList.toggle('stqa_in', chosen.has(name));
                const check = row.querySelector('.stqa_folder_check');
                check.classList.toggle('fa-square', !chosen.has(name));
                check.classList.toggle('fa-square-check', chosen.has(name));
            });
            box.querySelector('.stqa_folder_items').append(row);
        }
        if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton: '넣기', cancelButton: '나중에', allowVerticalScrolling: true }).show() && chosen.size) {
            moveTo(folder.id, orderedPresetNames().filter(name => chosen.has(name)));
        }
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
                openView(id);
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
                // Ticked prompts go straight into the new folder; otherwise they are picked now
                if (picked.size) {
                    moveTo(folder.id, [...picked]);
                    picked.clear();
                } else {
                    await pickInto(folder);
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
                if (!await ask('폴더 삭제', `"${folder.name}" 폴더를 지웁니다. 안의 프롬프트는 지워지지 않고 폴더 밖으로 나옵니다.`, '삭제')) {
                    return;
                }
                storeFolders(folders().filter(item => item.id !== folder.id));
                saveOrder((getSettings().presetOrder ?? []).filter(key => key !== folderKey(folder.id)));
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

    const promptRow = (name) => {
        const row = document.createElement('div');
        row.className = `stqa_layout_row stqa_manage_row${picked.has(name) ? ' stqa_picked' : ''}`;
        row.dataset.key = name;
        row.innerHTML = '<div class="stqa_layout_handle fa-solid fa-grip-lines" title="끌어서 순서 바꾸기"></div><i class="fa-regular stqa_manage_check"></i><span class="stqa_layout_label"></span>';
        row.querySelector('.stqa_manage_check').classList.add(picked.has(name) ? 'fa-square-check' : 'fa-square');
        row.querySelector('.stqa_layout_label').textContent = name;
        row.addEventListener('click', (event) => {
            if (event.target.closest('.stqa_layout_handle')) {
                return;
            }
            picked.has(name) ? picked.delete(name) : picked.add(name);
            render();
        });
        return row;
    };

    /** A folder among the prompts: moved like them, tapped to open it. */
    const folderRow = ({ key, folder, members }) => {
        const row = document.createElement('div');
        row.className = 'stqa_layout_row stqa_manage_row stqa_manage_folder';
        row.dataset.key = key;
        row.innerHTML = '<div class="stqa_layout_handle fa-solid fa-grip-lines" title="끌어서 순서 바꾸기"></div><i class="fa-solid fa-folder"></i><span class="stqa_layout_label"></span><small></small><i class="fa-solid fa-chevron-right"></i>';
        row.querySelector('.stqa_layout_label').textContent = folder.name;
        row.querySelector('small').textContent = members.length;
        row.addEventListener('click', (event) => {
            if (!event.target.closest('.stqa_layout_handle')) {
                openView(folder.id);
            }
        });
        return row;
    };

    const renderList = (list) => {
        const entries = presetEntries();
        if (view === ALL) {
            if (!entries.length) {
                list.innerHTML = '<div class="stqa_hint">프롬프트가 없습니다.</div>';
                return;
            }
            list.append(...entries.map(entry => (entry.folder ? folderRow(entry) : promptRow(entry.name))));
            enableDragging(list, (keys) => {
                const byKey = new Map(entries.map(entry => [entry.key, entry]));
                saveOrder(sequenceOf(keys.map(key => byKey.get(key))));
            });
            return;
        }
        const shown = entries.find(entry => entry.folder?.id === view)?.members ?? [];
        if (!shown.length) {
            list.innerHTML = '<div class="stqa_hint">이 폴더는 비어 있습니다. "전체"에서 프롬프트를 체크한 뒤 이 폴더로 옮깁니다.</div>';
            return;
        }
        list.append(...shown.map(promptRow));
        enableDragging(list, (keys) => {
            // The folder's prompts take the places they had, in the new order
            const queue = [...keys];
            const set = new Set(keys);
            saveOrder(sequenceOf(presetEntries()).map(key => (set.has(key) ? queue.shift() : key)));
        });
    };

    // Ticks are for the prompts in sight: another view starts with none
    const openView = (id) => {
        view = id;
        picked.clear();
        render();
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
