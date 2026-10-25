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
const RECENT_MESSAGES = 4;
// Per-message wrappers that aren't buttons themselves
const CONTAINER_KEYS = new Set(['extraMesButtons']);
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
        // Menus and sending must stay reachable (stop / script controls only appear while
        // running, so they never show up in the list)
        locked: ['options_button', 'extensionsMenuButton', 'send_but'],
    },
    {
        title: '메시지 메뉴',
        containers: [
            // Themes differ: the first row may sit inside a "…" menu or always be visible
            { selector: '.extraMesButtons', label: '기능 버튼 (번역·복사 등)', perMessage: true },
            { selector: '.mes_buttons', label: '수정·삭제 버튼 줄', perMessage: true },
        ],
        // The "…" toggle (in themes that have it) and the edit button keep every action reachable
        locked: ['extraMesButtonsHint', 'mes_edit'],
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
    mes_impersonate: '대신 써주기 (Impersonate)',
    mes_continue: '이어쓰기 (Continue)',
    extraMesButtonsHint: '… (메뉴 펼치기)',
    mes_edit: '수정',
    mes_bookmark: '체크포인트 표시 (깃발)',
    stqa_mes_delete: '삭제 (편의성 모음)',
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

/**
 * Full arrangement of a container: the saved items fill the slots that saved items naturally
 * occupy, so items that weren't in the list (invisible ones, the "…" box, items added later)
 * keep their natural place instead of moving to the end.
 */
function arrange(order, naturalKeys) {
    const placed = new Set(order);
    const queue = order.filter(key => naturalKeys.includes(key));
    const result = naturalKeys.map(key => (placed.has(key) ? queue.shift() : key));
    return [...result, ...order.filter(key => !result.includes(key))];
}

function applyContainer(selector) {
    const container = document.querySelector(selector);
    if (!container) {
        return;
    }
    const { order, hidden } = getLayout(selector);
    // Block containers (the extensions panel columns) only become flex once the user reorders them
    container.classList.toggle(FLEX_CLASS, order.length > 0 && getComputedStyle(container).display === 'block');

    const children = [...container.children];
    const keys = children.map(element => keyOf(element, false));
    const full = order.length > 0 ? arrange(order, keys) : [];
    children.forEach((element, domIndex) => {
        const key = keys[domIndex];
        element.setAttribute(KEY_ATTR, key);
        const value = order.length > 0 ? String(full.indexOf(key)) : '';
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

/**
 * Whether the page / theme displays the element, ignoring this extension's own hiding (items
 * the user hid here must stay listed so they can be shown again).
 */
function isDisplayed(element) {
    const hiddenByUs = element.classList.contains(HIDDEN_CLASS);
    hiddenByUs && element.classList.remove(HIDDEN_CLASS);
    const displayed = getComputedStyle(element).display !== 'none';
    hiddenByUs && element.classList.add(HIDDEN_CLASS);
    return displayed;
}

/**
 * Buttons the current theme actually shows on messages, collected from the last few rendered
 * messages (user and AI messages can differ). Containers (the "…" menu box) aren't buttons.
 * Falls back to the message template when no chat is open.
 */
function messageButtons(selector) {
    const style = document.getElementById(STYLE_ID);
    const rendered = [...document.querySelectorAll(`#chat .mes ${selector}`)].slice(-RECENT_MESSAGES);
    const sources = rendered.length > 0 ? rendered : [document.querySelector(`#message_template ${selector}`)];
    // Measure without this extension's rules, so hidden-by-us buttons still count as available
    if (style) {
        style.disabled = true;
    }
    const buttons = new Map();
    try {
        for (const source of sources) {
            for (const element of source?.children ?? []) {
                const key = buttonClassOf(element);
                if (key && !CONTAINER_KEYS.has(key) && !buttons.has(key) && (rendered.length === 0 || isDisplayed(element))) {
                    buttons.set(key, element);
                }
            }
        }
    } finally {
        if (style) {
            style.disabled = false;
        }
    }
    return [...buttons.entries()].map(([key, element]) => ({ key, element }));
}

function childKeys(container) {
    return [...container?.children ?? []].map(buttonClassOf).filter(Boolean);
}

/**
 * Button keys of a per-message container in page order. A rendered message comes first, since
 * other extensions add buttons to rendered messages only (often at the start); buttons that only
 * the template has go after their template neighbour.
 */
function naturalMessageKeys(selector) {
    const keys = childKeys([...document.querySelectorAll(`#chat .mes ${selector}`)].at(-1));
    const templateKeys = childKeys(document.querySelector(`#message_template ${selector}`));
    templateKeys.forEach((key, index) => {
        if (!keys.includes(key)) {
            const previous = templateKeys.slice(0, index).findLast(other => keys.includes(other));
            keys.splice(previous ? keys.indexOf(previous) + 1 : 0, 0, key);
        }
    });
    return [...new Set(keys)];
}

/**
 * Rewrites the one stylesheet that arranges the buttons of every message, so it covers every
 * current and future message. Buttons that aren't known yet (added later by other extensions)
 * go after the arranged ones.
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
            const full = arrange(order, naturalMessageKeys(selector));
            rules.push(`${scope} * { order: ${full.length}; }`);
            full.forEach((key, index) => rules.push(`${scope} .${CSS.escape(key)} { order: ${index}; }`));
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
    const text = rules.join('\n');
    if (style.textContent !== text) {
        style.textContent = text;
    }
}

/** Rebuilds the message button rules once messages are drawn (their buttons may differ from the template). */
function watchRenderedMessages() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    let scheduled = false;
    const refresh = () => {
        if (scheduled) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            applyMessageStyles();
        });
    };
    for (const type of [eventTypes.CHAT_CHANGED, eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED]) {
        eventSource.on(type, refresh);
    }
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
        const buttons = messageButtons(selector);
        const full = arrange(order, buttons.map(({ key }) => key));
        entries = buttons.map(({ key, element }, index) => ({
            key, element, sortIndex: natural ? index : full.indexOf(key),
        }));
    } else {
        const container = document.querySelector(selector);
        // Only what the page shows: e.g. script controls or the hidden input-bar copies of
        // Impersonate / Continue stay out of the list
        entries = [...(container?.children ?? [])]
            .filter(element => isMeaningful(element) && isDisplayed(element))
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
            icon: iconOf(element),
            hidden: !natural && hidden.includes(key),
            locked: lockedKeys.has(key),
        }));
}

/**
 * Stores and applies a container's arrangement (locked items can never be hidden). An order
 * that matches the page's own isn't stored, so untouched containers stay as the page lays them out.
 */
export function saveLayout(selector, { order, hidden }) {
    const natural = listItems(selector, { natural: true }).map(item => item.key);
    const unchanged = order.length === natural.length && order.every((key, index) => key === natural[index]);
    getSettings().layout[selector] = { order: unchanged ? [] : [...order], hidden: hidden.filter(key => !lockedKeys.has(key)) };
    findContainer(selector)?.perMessage ? applyMessageStyles() : applyContainer(selector);
}

export function initLayoutManager() {
    applyMessageStyles();
    watchRenderedMessages();
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
