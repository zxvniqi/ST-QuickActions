// Editor for the folders of one list. Folders are tabs at the top (＋ makes a new one); the
// folder picked is named and removed right there, and tapping an item below puts it in that
// folder or takes it out.
import { FOLDER_AREAS, getFolders, saveFolders, listAreaItems, gatherFolderItems } from './folders.js';

function newId() {
    return Math.random().toString(36).slice(2, 10);
}

/** Whether the page shows an item (not hidden in 메뉴 정리 or by its own extension). */
function isShown(element) {
    // Hidden only because its folder is folded
    if (element.classList.contains('stqa_folded')) {
        return true;
    }
    const display = getComputedStyle(element).display;
    if (display === 'contents') {
        return [...element.children].some(isShown);
    }
    return display !== 'none';
}

/** The items of the list once each (the same item may show in more than one place), hidden ones left out. */
function uniqueItems(area) {
    const seen = new Set();
    return listAreaItems(area).filter(({ key, element }) => isShown(element) && !seen.has(key) && seen.add(key));
}

export async function openFolderEditor(area) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const config = FOLDER_AREAS[area];
    // Work on a copy; saved when the editor closes with 저장
    const folders = structuredClone(getFolders(area));
    const items = uniqueItems(area);
    // No folder is picked at first: the list shows where everything is
    let current = null;

    const content = document.createElement('div');
    content.className = 'stqa_folder_editor';

    const addFolder = async () => {
        const name = await Popup.show.input('새 폴더', '폴더 이름을 입력합니다.', '');
        if (typeof name === 'string' && name.trim()) {
            current = { id: newId(), name: name.trim(), keys: [] };
            folders.push(current);
            render();
        }
    };

    const renderTabs = (box) => {
        for (const folder of folders) {
            const tab = document.createElement('div');
            tab.className = `stqa_folder_tab${folder === current ? ' stqa_active' : ''}`;
            tab.innerHTML = '<i class="fa-solid fa-folder"></i><span></span><small></small>';
            tab.querySelector('span').textContent = folder.name;
            tab.querySelector('small').textContent = folder.keys.length;
            tab.addEventListener('click', () => {
                current = folder;
                render();
            });
            box.append(tab);
        }
        const add = document.createElement('div');
        add.className = 'stqa_folder_tab stqa_folder_add';
        add.innerHTML = '<i class="fa-solid fa-plus"></i><span>새 폴더</span>';
        add.addEventListener('click', addFolder);
        box.append(add);
    };

    const renderCurrent = (box) => {
        box.innerHTML = '<input class="text_pole" type="text" title="폴더 이름"><div class="menu_button stqa_folder_delete"><i class="fa-solid fa-trash-can"></i><span>폴더 삭제</span></div>';
        const name = box.querySelector('input');
        name.value = current.name;
        name.addEventListener('input', () => {
            current.name = name.value.trim() || current.name;
            content.querySelector('.stqa_folder_tab.stqa_active span').textContent = current.name;
        });
        box.querySelector('.stqa_folder_delete').addEventListener('click', async () => {
            const question = document.createElement('div');
            question.innerHTML = '<h3>폴더 삭제</h3><div></div>';
            question.querySelector('div').textContent = `"${current.name}" 폴더를 지웁니다. 안의 항목은 지워지지 않고 폴더 밖으로 나옵니다.`;
            if (!await new Popup(question, POPUP_TYPE.CONFIRM, '', { okButton: '삭제', cancelButton: '취소' }).show()) {
                return;
            }
            // Only the folder goes; its items stay where they are in the list
            folders.splice(folders.indexOf(current), 1);
            current = null;
            render();
        });
    };

    const renderItems = (box) => {
        if (items.length === 0) {
            box.innerHTML = '<div class="stqa_hint">항목이 없습니다. 그 목록을 한 번 열어 본 뒤 다시 시도합니다.</div>';
            return;
        }
        for (const item of items) {
            const owner = folders.find(folder => folder.keys.includes(item.key));
            const row = document.createElement('div');
            const inCurrent = Boolean(current) && owner === current;
            row.className = `stqa_folder_item${inCurrent ? ' stqa_in' : ''}${current ? '' : ' stqa_readonly'}`;
            row.innerHTML = '<i class="fa-solid stqa_folder_check"></i><span class="stqa_folder_item_label"></span><small class="stqa_folder_item_owner"></small>';
            row.querySelector('.stqa_folder_check').classList.add(inCurrent ? 'fa-square-check' : 'fa-square');
            row.querySelector('.stqa_folder_item_label').textContent = item.label;
            if (owner && owner !== current) {
                row.querySelector('.stqa_folder_item_owner').textContent = owner.name;
            }
            row.addEventListener('click', () => {
                if (!current) {
                    return;
                }
                // An item is in one folder at most: picking it here takes it out of any other
                folders.forEach(folder => (folder.keys = folder.keys.filter(key => key !== item.key)));
                if (owner !== current) {
                    current.keys.push(item.key);
                }
                render();
            });
            box.append(row);
        }
    };

    const render = () => {
        const scroll = content.closest('.popup-content')?.scrollTop ?? 0;
        content.innerHTML = `
            <h3>${config.title} 폴더</h3>
            <div class="stqa_folder_tabs"></div>
            <div class="stqa_folder_current"></div>
            <div class="stqa_hint stqa_folder_help"></div>
            <div class="stqa_folder_items"></div>`;
        renderTabs(content.querySelector('.stqa_folder_tabs'));
        const help = content.querySelector('.stqa_folder_help');
        if (current) {
            renderCurrent(content.querySelector('.stqa_folder_current'));
            help.textContent = `항목을 누르면 "${current.name}" 폴더에 넣거나 뺍니다. 오른쪽에 이름이 적힌 항목은 다른 폴더에 들어 있습니다.`;
        } else {
            content.querySelector('.stqa_folder_current').remove();
            help.textContent = folders.length
                ? '위에서 폴더를 고르면 항목을 넣거나 뺄 수 있습니다. 오른쪽 이름은 그 항목이 든 폴더입니다.'
                : '폴더가 없습니다. "새 폴더"를 눌러 먼저 폴더를 만듭니다.';
        }
        renderItems(content.querySelector('.stqa_folder_items'));
        const scroller = content.closest('.popup-content');
        if (scroller) {
            scroller.scrollTop = scroll;
        }
    };
    render();

    const saved = await new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소', allowVerticalScrolling: true }).show();
    if (saved) {
        saveFolders(area, folders);
        // Regex scripts in a folder are put next to each other, so the folder holds together
        await gatherFolderItems(area);
    }
}
