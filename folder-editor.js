// Editor for the folders of one list: make / rename / remove folders and pick each item's folder.
import { FOLDER_AREAS, getFolders, saveFolders, listAreaItems } from './folders.js';

const NONE = '';

function newId() {
    return Math.random().toString(36).slice(2, 10);
}

export async function openFolderEditor(area) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const config = FOLDER_AREAS[area];
    // Work on a copy; saved when the editor closes with 저장
    const folders = structuredClone(getFolders(area));
    const items = listAreaItems(area);
    const folderOf = key => folders.find(folder => folder.keys.includes(key))?.id ?? NONE;

    const content = document.createElement('div');
    content.className = 'stqa_folder_editor';

    const render = () => {
        content.innerHTML = `
            <h3>${config.title} 폴더</h3>
            <small class="stqa_hint">폴더를 만들고, 아래에서 항목마다 넣을 폴더를 고르세요. 폴더는 접힌 채로 보이고, 누르면 펼쳐져요.</small>
            <div class="stqa_folder_list"></div>
            <div class="stqa_folder_new">
                <input class="text_pole" type="text" placeholder="새 폴더 이름">
                <div class="menu_button stqa_folder_create"><i class="fa-solid fa-folder-plus"></i> 만들기</div>
            </div>
            <div class="stqa_folder_items"></div>`;
        const list = content.querySelector('.stqa_folder_list');
        for (const folder of folders) {
            const row = document.createElement('div');
            row.className = 'stqa_folder_edit_row';
            row.innerHTML = '<i class="fa-solid fa-folder"></i><input class="text_pole" type="text"><small></small><i class="fa-solid fa-trash-can stqa_folder_delete" title="폴더 지우기 (항목은 그대로)"></i>';
            const name = row.querySelector('input');
            name.value = folder.name;
            name.addEventListener('input', () => (folder.name = name.value.trim() || folder.name));
            row.querySelector('small').textContent = `${folder.keys.length}개`;
            row.querySelector('.stqa_folder_delete').addEventListener('click', () => {
                folders.splice(folders.indexOf(folder), 1);
                render();
            });
            list.append(row);
        }
        const nameInput = content.querySelector('.stqa_folder_new input');
        const create = () => {
            const name = nameInput.value.trim();
            if (name) {
                folders.push({ id: newId(), name, keys: [] });
                render();
            }
        };
        content.querySelector('.stqa_folder_create').addEventListener('click', create);
        nameInput.addEventListener('keydown', event => event.key === 'Enter' && create());

        const itemBox = content.querySelector('.stqa_folder_items');
        if (items.length === 0) {
            itemBox.innerHTML = '<small class="stqa_hint">항목이 없어요. 그 목록을 한 번 열어둔 다음 다시 시도해 주세요.</small>';
        }
        const seen = new Set();
        for (const item of items) {
            if (seen.has(item.key)) {
                continue;
            }
            seen.add(item.key);
            const row = document.createElement('label');
            row.className = 'stqa_folder_item_row';
            row.innerHTML = '<span class="stqa_folder_item_label"></span><select class="text_pole"></select>';
            row.querySelector('.stqa_folder_item_label').textContent = item.label;
            const select = row.querySelector('select');
            select.append(new Option('폴더 없음', NONE), ...folders.map(folder => new Option(folder.name, folder.id)));
            select.value = folderOf(item.key);
            select.disabled = folders.length === 0;
            select.addEventListener('change', () => {
                folders.forEach(folder => (folder.keys = folder.keys.filter(key => key !== item.key)));
                folders.find(folder => folder.id === select.value)?.keys.push(item.key);
                list.querySelectorAll('.stqa_folder_edit_row small').forEach((count, index) => (count.textContent = `${folders[index].keys.length}개`));
            });
            itemBox.append(row);
        }
    };
    render();

    const saved = await new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소', allowVerticalScrolling: true }).show();
    if (saved) {
        saveFolders(area, folders);
    }
}
