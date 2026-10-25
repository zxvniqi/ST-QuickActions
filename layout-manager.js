// Hide and reorder items in the wand menu, the chat input bar and the extensions panel.
// Items are never moved in the DOM (other extensions may rely on their position): order uses
// the CSS `order` property on flex containers, hiding uses a class. Items added later by other
// extensions are picked up by a MutationObserver.
import { MODULE, getSettings } from './settings.js';

const HIDDEN_CLASS = 'stqa_layout_hidden';
const FLEX_CLASS = 'stqa_layout_flex';
const KEY_ATTR = 'data-stqa-key';

/** Containers that can be arranged, grouped the way they appear in the settings window. */
export const LAYOUT_AREAS = Object.freeze([
    {
        title: '마법봉 메뉴',
        containers: [{ selector: '#extensionsMenu', label: '' }],
        // Hiding this would lock the user out of these settings
        locked: [`${MODULE}_menu`],
    },
    {
        title: '입력창 버튼',
        containers: [
            { selector: '#leftSendForm', label: '왼쪽' },
            { selector: '#rightSendForm', label: '오른쪽' },
        ],
        // Menus, sending, stopping and script controls must stay reachable
        locked: ['options_button', 'extensionsMenuButton', 'send_but', 'mes_stop', 'stscript_continue', 'stscript_pause', 'stscript_stop'],
    },
    {
        title: '확장 패널',
        containers: [
            { selector: '#extensions_settings', label: '왼쪽 열' },
            { selector: '#extensions_settings2', label: '오른쪽 열' },
        ],
        locked: [],
    },
]);

const lockedKeys = new Set(LAYOUT_AREAS.flatMap(area => area.locked));

// Built-in input bar buttons have only icons, so give them readable names
const KNOWN_LABELS = Object.freeze({
    options_button: '옵션 메뉴 (≡)',
    extensionsMenuButton: '마법봉 메뉴 버튼',
    send_but: '보내기',
    mes_stop: '생성 중지',
    stscript_continue: '스크립트 계속',
    stscript_pause: '스크립트 일시정지',
    stscript_stop: '스크립트 중단',
    mes_impersonate: '대신 써주기 (Impersonate)',
    mes_continue: '이어쓰기 (Continue)',
});

/** A readable name for an item: a known name, its heading/title/text, or the id. */
function labelOf(element) {
    if (KNOWN_LABELS[element.id]) {
        return KNOWN_LABELS[element.id];
    }
    const heading = element.querySelector('.inline-drawer-header b, .inline-drawer-header');
    const text = (heading?.textContent || element.getAttribute('title') || element.textContent || '').trim().split('\n')[0].trim();
    return (text || element.id || '(이름 없음)').slice(0, 40);
}

function keyOf(element) {
    return element.id || `text:${labelOf(element)}`;
}

/** Empty placeholder containers (built-in extensions that aren't loaded) are skipped. */
function isMeaningful(element) {
    return element.children.length > 0 || element.textContent.trim() !== '' || element.matches('[class*="fa-"]');
}

function getLayout(selector) {
    const layout = getSettings().layout;
    layout[selector] ??= { order: [], hidden: [] };
    return layout[selector];
}

function applyContainer(selector) {
    const container = document.querySelector(selector);
    if (!container) {
        return;
    }
    const { order, hidden } = getLayout(selector);
    // Block containers (the extensions panel columns) only become flex once the user reorders them
    container.classList.toggle(FLEX_CLASS, order.length > 0 && getComputedStyle(container).display === 'block');

    [...container.children].forEach((element, domIndex) => {
        const key = keyOf(element);
        element.setAttribute(KEY_ATTR, key);
        const position = order.indexOf(key);
        // Items the user never placed keep their natural order, after the placed ones
        const value = order.length > 0 ? String(position === -1 ? order.length + domIndex : position) : '';
        element.style.order = value;
        // ST's extension containers use `display: contents`; their children are the real flex items
        if (getComputedStyle(element).display === 'contents') {
            for (const child of element.children) {
                child.style.order = value;
            }
        }
        element.classList.toggle(HIDDEN_CLASS, hidden.includes(key) && !lockedKeys.has(key));
    });
}

export function applyAllLayouts() {
    for (const area of LAYOUT_AREAS) {
        for (const { selector } of area.containers) {
            applyContainer(selector);
        }
    }
}

/** Current items of a container in their displayed order, for the settings window. */
export function listItems(selector) {
    const container = document.querySelector(selector);
    if (!container) {
        return [];
    }
    const { hidden } = getLayout(selector);
    return [...container.children]
        .map((element, domIndex) => ({ element, sortIndex: element.style.order === '' ? domIndex : Number(element.style.order) }))
        .filter(({ element }) => isMeaningful(element))
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map(({ element }) => {
            const key = keyOf(element);
            return { key, label: labelOf(element), hidden: hidden.includes(key), locked: lockedKeys.has(key) };
        });
}

export function setHidden(selector, key, isHidden) {
    if (lockedKeys.has(key)) {
        return;
    }
    const layout = getLayout(selector);
    layout.hidden = layout.hidden.filter(item => item !== key);
    if (isHidden) {
        layout.hidden.push(key);
    }
    applyContainer(selector);
    SillyTavern.getContext().saveSettingsDebounced();
}

/** Moves an item one step up (-1) or down (+1) among the listed items. */
export function moveItem(selector, key, direction) {
    const keys = listItems(selector).map(item => item.key);
    const from = keys.indexOf(key);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= keys.length) {
        return;
    }
    [keys[from], keys[to]] = [keys[to], keys[from]];
    getLayout(selector).order = keys;
    applyContainer(selector);
    SillyTavern.getContext().saveSettingsDebounced();
}

export function resetArea(area) {
    for (const { selector } of area.containers) {
        getSettings().layout[selector] = { order: [], hidden: [] };
        applyContainer(selector);
    }
    SillyTavern.getContext().saveSettingsDebounced();
}

export function initLayoutManager() {
    for (const area of LAYOUT_AREAS) {
        for (const { selector } of area.containers) {
            const container = document.querySelector(selector);
            if (!container) {
                continue;
            }
            // Other extensions add their items at different times; arrange them as they arrive
            let scheduled = false;
            const observer = new MutationObserver(() => {
                if (scheduled) {
                    return;
                }
                scheduled = true;
                requestAnimationFrame(() => {
                    scheduled = false;
                    applyContainer(selector);
                });
            });
            observer.observe(container, { childList: true });
            applyContainer(selector);
        }
    }
}
