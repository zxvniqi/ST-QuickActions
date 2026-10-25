// Hide and reorder items in the wand menu, the chat input bar, the extensions panel and the
// per-message buttons. Items are never moved in the DOM (other extensions may rely on their
// position): order uses the CSS `order` property on flex containers, hiding uses a class.
//  - Single containers (menu, input bar, panel): items are tagged directly, and items other
//    extensions add later are picked up by a MutationObserver.
//  - Message buttons exist once per message, so they're arranged by one generated stylesheet
//    (keyed by each button's class) that covers every current and future message at no cost.
import { MODULE, getSettings } from './settings.js';

const HIDDEN_CLASS = 'stqa_layout_hidden';
const FLEX_CLASS = 'stqa_layout_flex';
const KEY_ATTR = 'data-stqa-key';
const STYLE_ID = 'stqa_layout_style';
// Classes shared by many buttons, so they can't identify one
const GENERIC_CLASS = /^(mes_button|fa-|fa$|interactable|displayNone|menu_button|list-group-item)/;

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
        title: '메시지 메뉴',
        containers: [
            { selector: '.extraMesButtons', label: '… 버튼을 누르면 나오는 메뉴', perMessage: true },
            { selector: '.mes_buttons', label: '메시지 옆에 늘 보이는 버튼', perMessage: true },
        ],
        // The "…" toggle, the menu it opens and the edit button keep every action reachable
        locked: ['extraMesButtonsHint', 'extraMesButtons', 'mes_edit'],
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

const CONTAINERS = LAYOUT_AREAS.flatMap(area => area.containers);
const lockedKeys = new Set(LAYOUT_AREAS.flatMap(area => area.locked));

// Built-in buttons that have only icons, so give them readable names
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
    extraMesButtonsHint: '… (메뉴 펼치기)',
    extraMesButtons: '… 메뉴 (펼쳐지는 자리)',
    mes_edit: '수정',
    mes_bookmark: '체크포인트 표시 (깃발)',
    stqa_mes_delete: '삭제 (편의성 모음)',
});
// Containers whose first inner icon isn't theirs
const KNOWN_ICONS = Object.freeze({
    extraMesButtons: 'fa-solid fa-ellipsis-vertical',
});

function findContainer(selector) {
    return CONTAINERS.find(container => container.selector === selector);
}

/** For per-message buttons: the first class that names this button specifically. */
function buttonClassOf(element) {
    return [...element.classList].find(cls => !GENERIC_CLASS.test(cls)) ?? null;
}

function keyOf(element, perMessage) {
    if (perMessage) {
        return buttonClassOf(element);
    }
    return element.id || `text:${labelOf(element)}`;
}

/** A readable name for an item: a known name, its heading/title/text, or the id. */
function labelOf(element, key = element.id) {
    if (KNOWN_LABELS[key]) {
        return KNOWN_LABELS[key];
    }
    const heading = element.querySelector('.inline-drawer-header b, .inline-drawer-header');
    const text = (heading?.textContent || element.getAttribute('title') || element.textContent || '').trim().split('\n')[0].trim();
    return (text || key || '(이름 없음)').slice(0, 40);
}

/** Font Awesome classes of the item's own icon (the button itself, or its menu icon). */
function iconOf(element) {
    const iconClasses = node => [...node.classList].filter(cls => cls.startsWith('fa')).join(' ');
    if ([...element.classList].some(cls => cls.startsWith('fa-'))) {
        return iconClasses(element);
    }
    const icon = element.querySelector('.extensionsMenuExtensionButton, [class*="fa-"]:not(.inline-drawer-icon)');
    return icon ? iconClasses(icon) : '';
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

/** Position of an item: its saved place, or after the placed ones in its natural order. */
function orderValue(order, key, naturalIndex) {
    const position = order.indexOf(key);
    return position === -1 ? order.length + naturalIndex : position;
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
        const key = keyOf(element, false);
        element.setAttribute(KEY_ATTR, key);
        const value = order.length > 0 ? String(orderValue(order, key, domIndex)) : '';
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

/** Per-message buttons as found in the message template plus the newest rendered message. */
function messageButtons(selector) {
    const sources = [
        document.querySelector(`#message_template ${selector}`),
        [...document.querySelectorAll(`#chat .mes ${selector}`)].pop(),
    ];
    const buttons = new Map();
    for (const source of sources) {
        for (const element of source?.children ?? []) {
            const key = buttonClassOf(element);
            if (key && !buttons.has(key)) {
                buttons.set(key, element);
            }
        }
    }
    return [...buttons.entries()].map(([key, element]) => ({ key, element }));
}

/**
 * Rewrites the one stylesheet that arranges the buttons of every message. Built from the saved
 * layout only, so buttons other extensions add later are covered too: unplaced buttons share
 * one order value after the placed ones and therefore keep their natural order.
 */
function applyMessageStyles() {
    const rules = [];
    for (const { selector, perMessage } of CONTAINERS) {
        if (!perMessage) {
            continue;
        }
        const { order, hidden } = getLayout(selector);
        const scope = `#chat .mes ${selector} >`;
        if (order.length > 0) {
            rules.push(`${scope} * { order: ${order.length}; }`);
            order.forEach((key, index) => rules.push(`${scope} .${CSS.escape(key)} { order: ${index}; }`));
        }
        for (const key of hidden) {
            if (!lockedKeys.has(key)) {
                rules.push(`${scope} .${CSS.escape(key)} { display: none !important; }`);
            }
        }
    }
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.append(style);
    }
    style.textContent = rules.join('\n');
}

/**
 * Items of a container for the settings window, in their displayed order, or in the page's
 * own order with `natural` (used for "reset").
 * @returns {{ key: string, label: string, icon: string, hidden: boolean, locked: boolean }[]}
 */
export function listItems(selector, { natural = false } = {}) {
    const { hidden, order } = getLayout(selector);
    let entries;
    if (findContainer(selector)?.perMessage) {
        entries = messageButtons(selector).map(({ key, element }, index) => ({
            key, element, sortIndex: natural ? index : orderValue(order, key, index),
        }));
    } else {
        const container = document.querySelector(selector);
        entries = [...(container?.children ?? [])]
            .filter(isMeaningful)
            .map((element, index) => ({
                key: keyOf(element, false),
                element,
                sortIndex: natural || element.style.order === '' ? index : Number(element.style.order),
            }));
    }
    return entries
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map(({ key, element }) => ({
            key,
            label: labelOf(element, key),
            icon: KNOWN_ICONS[key] ?? iconOf(element),
            hidden: !natural && hidden.includes(key),
            locked: lockedKeys.has(key),
        }));
}

/** Stores and applies a container's arrangement (locked items can never be hidden). */
export function saveLayout(selector, { order, hidden }) {
    getSettings().layout[selector] = { order: [...order], hidden: hidden.filter(key => !lockedKeys.has(key)) };
    findContainer(selector)?.perMessage ? applyMessageStyles() : applyContainer(selector);
}

export function initLayoutManager() {
    applyMessageStyles();
    for (const { selector, perMessage } of CONTAINERS) {
        const container = perMessage ? null : document.querySelector(selector);
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
