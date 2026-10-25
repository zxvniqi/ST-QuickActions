// Settings window for hiding / reordering wand menu items, input bar buttons and extension panels.
import { LAYOUT_AREAS, listItems, setHidden, moveItem, resetArea } from './layout-manager.js';

function renderRows(listElement, selector) {
    const fragment = document.createDocumentFragment();
    const items = listItems(selector);
    items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'stqa_layout_row';
        row.dataset.key = item.key;
        row.classList.toggle('stqa_layout_row_hidden', item.hidden);
        row.innerHTML = `
            <input type="checkbox" class="stqa_layout_visible">
            <span class="stqa_layout_label"></span>
            <div class="stqa_layout_move fa-solid fa-chevron-up" data-direction="-1" title="위로"></div>
            <div class="stqa_layout_move fa-solid fa-chevron-down" data-direction="1" title="아래로"></div>`;
        const checkbox = row.querySelector('.stqa_layout_visible');
        checkbox.checked = !item.hidden;
        checkbox.disabled = item.locked;
        checkbox.title = item.locked ? '숨기면 위험해서 숨길 수 없어요' : '보이기';
        row.querySelector('.stqa_layout_label').textContent = `${item.locked ? '🔒 ' : ''}${item.label}`;
        row.querySelector('[data-direction="-1"]').classList.toggle('stqa_disabled', index === 0);
        row.querySelector('[data-direction="1"]').classList.toggle('stqa_disabled', index === items.length - 1);
        fragment.append(row);
    });
    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'stqa_hint';
        empty.textContent = '항목이 없어요.';
        fragment.append(empty);
    }
    listElement.replaceChildren(fragment);
}

function buildArea(area) {
    const section = document.createElement('details');
    section.className = 'stqa_layout_area';
    section.innerHTML = `<summary>${area.title}</summary><div class="stqa_layout_body"></div>`;
    const body = section.querySelector('.stqa_layout_body');

    for (const { selector, label } of area.containers) {
        const group = document.createElement('div');
        group.className = 'stqa_layout_group';
        group.innerHTML = `${label ? `<small class="stqa_hint">${label}</small>` : ''}<div class="stqa_layout_list"></div>`;
        const list = group.querySelector('.stqa_layout_list');
        renderRows(list, selector);

        list.addEventListener('change', (event) => {
            const row = event.target.closest('.stqa_layout_row');
            if (row && event.target.classList.contains('stqa_layout_visible')) {
                setHidden(selector, row.dataset.key, !event.target.checked);
                renderRows(list, selector);
            }
        });
        list.addEventListener('click', (event) => {
            const button = event.target.closest('.stqa_layout_move');
            if (button && !button.classList.contains('stqa_disabled')) {
                moveItem(selector, button.closest('.stqa_layout_row').dataset.key, Number(button.dataset.direction));
                renderRows(list, selector);
            }
        });
        body.append(group);
    }

    const reset = document.createElement('div');
    reset.className = 'menu_button stqa_panel_button';
    reset.innerHTML = '<i class="fa-solid fa-rotate-left"></i> 기본으로 되돌리기';
    reset.addEventListener('click', () => {
        resetArea(area);
        body.querySelectorAll('.stqa_layout_list').forEach((list, index) => renderRows(list, area.containers[index].selector));
    });
    body.append(reset);
    return section;
}

export async function openLayoutEditor() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const root = document.createElement('div');
    root.className = 'stqa_panel';
    root.innerHTML = `
        <h3>메뉴 정리</h3>
        <small class="stqa_hint">체크를 끄면 숨겨지고, 화살표로 순서를 바꿔요. 🔒 표시는 숨기면 쓸 수 없게 되는 항목이라 숨길 수 없어요.</small>`;
    for (const area of LAYOUT_AREAS) {
        root.append(buildArea(area));
    }
    await new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '닫기', leftAlign: true, allowVerticalScrolling: true }).show();
}
