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
// The message menu is one list: the feature-button box (번역·복사 등) inside the edit/delete
// row is unpacked into it. Themes that show the box inline get it flattened into one row.
const MESSAGE_ROW = '.mes_buttons';
const NESTED_BOX = 'extraMesButtons';
const LEGACY_NESTED_SELECTOR = '.extraMesButtons';
// Classes shared by many buttons, so they can't identify one
const GENERIC_CLASS = /^(mes_button|fa-|fa$|interactable|displayNone|menu_button|list-group-item)/;
// Buttons that take turns in one spot count as one item: Stop replaces Send while a reply is
// generated (script controls appear right before it), Unhide replaces Hide
const SAME_SPOT = Object.freeze({
    mes_stop: 'send_but',
    stscript_continue: 'send_but',
    stscript_pause: 'send_but',
    stscript_stop: 'send_but',
    mes_unhide: 'mes_hide',
});

const sameSpotKey = key => SAME_SPOT[key] ?? key;
const unique = list => [...new Set(list)];
/** A spot's key and the keys of the buttons that share it. */
const spotMembers = key => [key, ...Object.keys(SAME_SPOT).filter(other => SAME_SPOT[other] === key)];

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
        containers: [{ selector: MESSAGE_ROW, label: '', perMessage: true }],
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
    send_but: '보내기 / 요청 중단',
    mes_hide: '메시지 숨기기 / 다시 보이기',
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
    const key = perMessage ? buttonClassOf(element) : element.id || `text:${labelOf(element)}`;
    return key && sameSpotKey(key);
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

/** A container's saved arrangement, with buttons sharing a spot folded into one key. */
function getLayout(selector) {
    const saved = getSettings().layout[selector];
    return {
        order: unique((saved?.order ?? []).map(sameSpotKey)),
        hidden: unique((saved?.hidden ?? []).map(sameSpotKey)),
    };
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
    const full = order.length > 0 ? arrange(order, unique(keys)) : [];
    children.forEach((element, domIndex) => {
        const key = keys[domIndex];
        element.setAttribute(KEY_ATTR, key);
        // Buttons sharing a spot get the same value and so stay together in page order
        // (script controls come right before Send / Stop)
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

/** A message's buttons in page order, with the feature-button box unpacked in its place. */
function rowButtons(row) {
    return [...row?.children ?? []].flatMap(element => (element.classList.contains(NESTED_BOX) ? [...element.children] : [element]));
}

function rowKeys(row) {
    return unique(rowButtons(row).map(element => keyOf(element, true)).filter(Boolean));
}

/** Runs `measure` with this extension's message rules switched off. */
function withoutOwnRules(measure) {
    const style = document.getElementById(STYLE_ID);
    if (style) {
        style.disabled = true;
    }
    try {
        return measure();
    } finally {
        if (style) {
            style.disabled = false;
        }
    }
}

/**
 * Buttons the current theme actually shows on messages, collected from the last few rendered
 * messages (user and AI messages can differ). Falls back to the message template when no chat is open.
 */
function messageButtons() {
    const rendered = [...document.querySelectorAll(`#chat .mes ${MESSAGE_ROW}`)].slice(-RECENT_MESSAGES);
    const sources = rendered.length > 0 ? rendered : [document.querySelector(`#message_template ${MESSAGE_ROW}`)];
    const buttons = new Map();
    // Measured without this extension's rules, so buttons hidden here still count as available
    withoutOwnRules(() => {
        for (const element of sources.flatMap(rowButtons)) {
            const key = keyOf(element, true);
            const own = buttonClassOf(element) === key;
            // A spot shared by several buttons is shown with its main button when possible
            if (key && (!buttons.has(key) || (own && !buttons.get(key).own)) && (rendered.length === 0 || isDisplayed(element))) {
                buttons.set(key, { element, own });
            }
        }
    });
    return [...buttons.entries()].map(([key, { element }]) => ({ key, element }));
}

/**
 * Button keys of the message menu in page order. A rendered message comes first, since other
 * extensions add buttons to rendered messages only (often at the start); buttons that only the
 * template has go after their template neighbour.
 */
function naturalMessageKeys() {
    const keys = rowKeys([...document.querySelectorAll(`#chat .mes ${MESSAGE_ROW}`)].at(-1));
    const templateKeys = rowKeys(document.querySelector(`#message_template ${MESSAGE_ROW}`));
    templateKeys.forEach((key, index) => {
        if (!keys.includes(key)) {
            const previous = templateKeys.slice(0, index).findLast(other => keys.includes(other));
            keys.splice(previous ? keys.indexOf(previous) + 1 : 0, 0, key);
        }
    });
    return unique(keys);
}

// Whether the theme shows the feature-button box inline (no "…" menu); kept while no chat is open
let nestedBoxInline = false;

function detectInlineBox() {
    const row = [...document.querySelectorAll(`#chat .mes ${MESSAGE_ROW}`)].at(-1);
    const box = row?.querySelector(`:scope > .${NESTED_BOX}`);
    if (!box) {
        return;
    }
    withoutOwnRules(() => {
        const hint = row.querySelector(':scope > .extraMesButtonsHint');
        nestedBoxInline = getComputedStyle(box).display !== 'none' && (!hint || getComputedStyle(hint).display === 'none');
    });
}

/**
 * Rewrites the one stylesheet that arranges the buttons of every message, so it covers every
 * current and future message. Buttons that aren't known yet (added later by other extensions)
 * go after the arranged ones. Order values are shared by the row and the feature-button box:
 * themes that show the box inline get it flattened into the row, so the whole menu is one line;
 * with a "…" menu each button keeps its place relative to the others in its own box.
 */
function applyMessageStyles() {
    const rules = [];
    const { order, hidden } = getLayout(MESSAGE_ROW);
    const scopes = [`#chat .mes ${MESSAGE_ROW} >`, `#chat .mes ${MESSAGE_ROW} > .${NESTED_BOX} >`];
    const selectorFor = key => scopes.flatMap(scope => spotMembers(key).map(member => `${scope} .${CSS.escape(member)}`)).join(', ');
    detectInlineBox();
    if (order.length > 0) {
        if (nestedBoxInline) {
            rules.push(`#chat .mes ${MESSAGE_ROW} > .${NESTED_BOX} { display: contents !important; }`);
        }
        const full = arrange(order, naturalMessageKeys());
        rules.push(`${scopes.map(scope => `${scope} *`).join(', ')} { order: ${full.length}; }`);
        full.forEach((key, index) => rules.push(`${selectorFor(key)} { order: ${index}; }`));
    }
    for (const key of hidden) {
        if (!lockedKeys.has(key)) {
            rules.push(`${selectorFor(key)} { display: none !important; }`);
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

/**
 * Rebuilds the message button rules when buttons are added to drawn messages: other extensions
 * add theirs to rendered messages at their own time, so they aren't in the template.
 */
function watchRenderedMessages() {
    const chat = document.getElementById('chat');
    if (!chat) {
        return;
    }
    const containers = `${MESSAGE_ROW}, .${NESTED_BOX}`;
    let scheduled = false;
    new MutationObserver((records) => {
        // New messages, or buttons added to a message's button rows
        const relevant = records.some(record => record.addedNodes.length > 0 && (record.target === chat || record.target.matches?.(containers)));
        if (scheduled || !relevant) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            applyMessageStyles();
        });
    }).observe(chat, { childList: true, subtree: true });
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
        const buttons = messageButtons();
        const full = arrange(order, buttons.map(({ key }) => key));
        entries = buttons.map(({ key, element }, index) => ({
            key, element, sortIndex: natural ? index : full.indexOf(key),
        }));
    } else {
        const children = [...(document.querySelector(selector)?.children ?? [])];
        const keys = children.map(element => keyOf(element, false));
        // Only what the page shows (e.g. the hidden input-bar copies of Impersonate / Continue
        // stay out); a shared spot counts when any of its buttons shows, e.g. Stop while generating
        const shownKeys = new Set(keys.filter((key, index) => isMeaningful(children[index]) && isDisplayed(children[index])));
        entries = unique(keys).filter(key => shownKeys.has(key)).map((key, index) => {
            const element = children.find(child => child.id === key) ?? children[keys.indexOf(key)];
            return { key, element, sortIndex: natural || element.style.order === '' ? index : Number(element.style.order) };
        });
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

/**
 * Older versions arranged the feature-button box as a list of its own: fold it into the message
 * menu in its place, so the arrangement the user made looks the same.
 */
function migrateNestedLayout() {
    const layout = getSettings().layout;
    const nested = layout[LEGACY_NESTED_SELECTOR];
    if (!nested) {
        return;
    }
    const row = layout[MESSAGE_ROW] ?? { order: [], hidden: [] };
    if (nested.order?.length || row.order?.length) {
        const template = document.querySelector(`#message_template ${MESSAGE_ROW}`);
        const classesOf = container => [...container?.children ?? []].map(buttonClassOf).filter(Boolean);
        const rowOrder = row.order?.length ? row.order : classesOf(template);
        const nestedOrder = nested.order?.length ? nested.order : classesOf(template?.querySelector(`.${NESTED_BOX}`));
        const at = rowOrder.indexOf(NESTED_BOX);
        row.order = at === -1 ? [...nestedOrder, ...rowOrder] : [...rowOrder.slice(0, at), ...nestedOrder, ...rowOrder.slice(at + 1)];
    }
    row.hidden = unique([...(row.hidden ?? []), ...(nested.hidden ?? [])]);
    layout[MESSAGE_ROW] = row;
    delete layout[LEGACY_NESTED_SELECTOR];
    SillyTavern.getContext().saveSettingsDebounced();
}

export function initLayoutManager() {
    migrateNestedLayout();
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
