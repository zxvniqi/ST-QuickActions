// Settings window for hiding / reordering wand menu items, input bar buttons and extension panels.
// Changes are kept as a draft and only applied when the user presses 저장 (save).
import { LAYOUT_AREAS, listItems, saveLayout } from './layout-manager.js';

const FALLBACK_ICON = 'fa-solid fa-puzzle-piece';
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_STEP = 10;

/** Draft per container selector: items in order, with their hidden flag. */
function createDrafts() {
    const drafts = new Map();
    for (const area of LAYOUT_AREAS) {
        for (const { selector } of area.containers) {
            drafts.set(selector, listItems(selector));
        }
    }
    return drafts;
}

function renderList(listElement, items) {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
        const row = document.createElement('div');
        row.className = 'stqa_layout_row';
        row.dataset.key = item.key;
        row.classList.toggle('stqa_layout_row_hidden', item.hidden);
        row.innerHTML = `
            <div class="stqa_layout_handle fa-solid fa-grip-lines" title="끌어서 순서 바꾸기"></div>
            <div class="stqa_layout_icon"></div>
            <span class="stqa_layout_label"></span>
            <div class="stqa_layout_eye"></div>`;
        row.querySelector('.stqa_layout_icon').className = `stqa_layout_icon ${item.icon || FALLBACK_ICON}`;
        row.querySelector('.stqa_layout_label').textContent = item.label;
        const eye = row.querySelector('.stqa_layout_eye');
        if (item.locked) {
            eye.className = 'stqa_layout_eye stqa_locked fa-solid fa-lock';
            eye.title = '숨기면 쓸 수 없게 돼서 숨길 수 없어요';
        } else {
            eye.className = `stqa_layout_eye fa-solid ${item.hidden ? 'fa-eye-slash' : 'fa-eye'}`;
            eye.title = item.hidden ? '숨김 (눌러서 보이기)' : '보임 (눌러서 숨기기)';
        }
        fragment.append(row);
    }
    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'stqa_hint';
        empty.textContent = '항목이 없어요.';
        fragment.append(empty);
    }
    listElement.replaceChildren(fragment);
}

/** Pointer-based drag (works with touch): the row follows the finger, others make room. */
function enableDragging(listElement, onReorder) {
    listElement.addEventListener('pointerdown', (event) => {
        const handle = event.target.closest('.stqa_layout_handle');
        if (!handle) {
            return;
        }
        event.preventDefault();
        const row = handle.closest('.stqa_layout_row');
        const scroller = listElement.closest('.popup-content') ?? listElement.parentElement;
        row.classList.add('stqa_dragging');

        const onMove = (moveEvent) => {
            const y = moveEvent.clientY;
            const box = scroller.getBoundingClientRect();
            if (y < box.top + AUTO_SCROLL_EDGE) {
                scroller.scrollTop -= AUTO_SCROLL_STEP;
            } else if (y > box.bottom - AUTO_SCROLL_EDGE) {
                scroller.scrollTop += AUTO_SCROLL_STEP;
            }
            const next = [...listElement.children].find(other => other !== row && y < other.getBoundingClientRect().top + other.offsetHeight / 2);
            next ? listElement.insertBefore(row, next) : listElement.append(row);
        };
        // Listen on the document (not pointer capture), so the drag keeps working wherever the
        // finger goes and with any input type
        const onEnd = () => {
            row.classList.remove('stqa_dragging');
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onEnd);
            document.removeEventListener('pointercancel', onEnd);
            onReorder([...listElement.children].map(child => child.dataset.key));
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
    });
}

function buildGroup(selector, label, drafts) {
    const group = document.createElement('div');
    group.className = 'stqa_layout_group';
    group.innerHTML = `${label ? `<div class="stqa_layout_group_title">${label}</div>` : ''}<div class="stqa_layout_list"></div>`;
    const list = group.querySelector('.stqa_layout_list');
    const render = () => renderList(list, drafts.get(selector));
    render();

    list.addEventListener('click', (event) => {
        const eye = event.target.closest('.stqa_layout_eye');
        if (!eye || eye.classList.contains('stqa_locked')) {
            return;
        }
        const item = drafts.get(selector).find(entry => entry.key === eye.closest('.stqa_layout_row').dataset.key);
        item.hidden = !item.hidden;
        render();
    });
    enableDragging(list, (keys) => {
        const byKey = new Map(drafts.get(selector).map(item => [item.key, item]));
        drafts.set(selector, keys.map(key => byKey.get(key)));
    });
    return group;
}

export async function openLayoutEditor() {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const drafts = createDrafts();

    const root = document.createElement('div');
    root.className = 'stqa_panel stqa_layout_editor';
    root.innerHTML = `
        <h3>메뉴 정리</h3>
        <small class="stqa_hint">≡ 를 끌어서 순서를 바꾸고, 눈 아이콘으로 숨기거나 보이게 해요. 🔒는 숨길 수 없는 항목이에요. 저장을 눌러야 적용돼요.</small>
        <div class="stqa_tabs"></div>
        <div class="stqa_tab_body"></div>
        <div class="menu_button stqa_panel_button stqa_layout_reset"><i class="fa-solid fa-rotate-left"></i> 이 탭 기본으로</div>`;
    const tabs = root.querySelector('.stqa_tabs');
    const body = root.querySelector('.stqa_tab_body');
    let activeArea = LAYOUT_AREAS[0];

    const showArea = (area) => {
        activeArea = area;
        for (const tab of tabs.children) {
            tab.classList.toggle('stqa_tab_active', tab.dataset.title === area.title);
        }
        body.replaceChildren(...area.containers.map(({ selector, label }) => buildGroup(selector, label, drafts)));
    };
    for (const area of LAYOUT_AREAS) {
        const tab = document.createElement('div');
        tab.className = 'stqa_tab';
        tab.dataset.title = area.title;
        tab.textContent = area.title;
        tab.addEventListener('click', () => showArea(area));
        tabs.append(tab);
    }
    root.querySelector('.stqa_layout_reset').addEventListener('click', () => {
        for (const { selector } of activeArea.containers) {
            drafts.set(selector, listItems(selector, { natural: true }));
        }
        showArea(activeArea);
    });
    showArea(activeArea);

    const result = await new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: '저장',
        cancelButton: '취소',
        leftAlign: true,
        allowVerticalScrolling: true,
    }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }
    for (const [selector, items] of drafts) {
        saveLayout(selector, {
            order: items.map(item => item.key),
            hidden: items.filter(item => item.hidden).map(item => item.key),
        });
    }
    SillyTavern.getContext().saveSettingsDebounced();
    toastr.success('메뉴 정리를 저장했어요.', '편의성 모음');
}
