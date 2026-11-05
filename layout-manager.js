// Hide and reorder items in the menus, the top bar, the chat input bar, the extensions panel
// and the per-message buttons. Items are never moved in the DOM (other extensions may rely on
// their position): everything is done by one generated stylesheet (CSS `order` on flex
// containers, `display: none` for hidden items). Rules match items by id (or, for items
// without one, by a key attribute set once), so they keep applying when the page or another
// extension redraws an item, rewrites its classes or translates its text.
//  - Single containers (menus, bars, panel): rebuilt when items are added or removed.
//  - Message buttons exist once per message, keyed by each button's class, so the same rules
//    cover every current and future message at no cost.
import { MODULE, getSettings, isOn } from './settings.js';

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
        title: '확장 메뉴',
        containers: [{ selector: '#extensionsMenu', label: '' }],

        // Hiding this would lock the user out of these settings
        locked: [`${MODULE}_menu`],
    },
    {
        title: '옵션 메뉴',
        containers: [{ selector: '#options .options-content', label: '' }],
        locked: [],
    },
    {
        title: '상단 바',
        fillRow: true,
        containers: [{ selector: '#top-settings-holder', label: '' }],
        locked: [],
    },
    {
        title: '입력창',
        // Items can go from one side to the other (see applyCrossArea)
        crossMove: true,
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
        title: '확장 설정',
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
    stqa_mes_to_bottom: '메시지 맨 아래로 (편의성 모음)',
    // Top bar drawers have only icons
    'ai-config-button': '프리셋 · AI 응답 설정',
    'sys-settings-button': 'API 연결',
    'advanced-formatting-button': '고급 서식 (프롬프트 템플릿)',
    'WI-SP-button': '월드인포 / 로어북',
    'user-settings-button': '사용자 설정 (테마 등)',
    'backgrounds-button': '배경',
    'extensions-settings-button': '확장 프로그램',
    'persona-management-button': '페르소나',
    rightNavHolder: '캐릭터 목록',
});

function findContainer(selector) {
    return CONTAINERS.find(container => container.selector === selector);
}

function findArea(selector) {
    return LAYOUT_AREAS.find(area => area.containers.some(container => container.selector === selector));
}

/** Re-applies (or, switched off, removes) every arrangement. */
export function applyLayoutSettings() {
    writeStyles();
}

/** For per-message buttons: the first class that names this button specifically. */
function buttonClassOf(element) {
    return [...element.classList].find(cls => !GENERIC_CLASS.test(cls)) ?? null;
}

/**
 * An item's key: its class (message buttons) or id. Items without an id get a key from their
 * text the first time they're seen, kept on the element, so later text changes (translation,
 * counters) don't make them a different item. Things that aren't items (separators) get a key
 * by their place, so they keep it.
 */
function keyOf(element, perMessage) {
    if (perMessage) {
        const key = buttonClassOf(element);
        return key && sameSpotKey(key);
    }
    if (element.id) {
        return sameSpotKey(element.id);
    }
    if (!element.hasAttribute(KEY_ATTR)) {
        const siblings = [...element.parentElement?.children ?? []];
        const key = isMeaningful(element)
            ? `text:${labelOf(element)}`
            : `slot:${element.tagName.toLowerCase()}:${siblings.filter(other => other.tagName === element.tagName).indexOf(element)}`;
        element.setAttribute(KEY_ATTR, key);
    }
    return element.getAttribute(KEY_ATTR);
}

/**
 * The element of a container's item with a key (the one shown, when there are copies), or null.
 * For a wrapper an extension puts around its menu entry, the entry inside it, which is what
 * takes the tap.
 */
export function findMenuItem(selector, key) {
    // A side of the input bar also has the loose items beside it, right in the bar
    const container = document.querySelector(selector);
    const area = findArea(selector);
    const pool = [...container?.children ?? [], ...(area?.crossMove && container?.parentElement ? [...container.parentElement.children] : [])];
    const children = pool.filter(element => element !== container && keyOf(element, false) === key);
    const element = children.find(child => withoutOwnRules(() => isDisplayed(child))) ?? children[0];
    if (!element) {
        return null;
    }
    return element.matches('.list-group-item') ? element : element.querySelector('.list-group-item') ?? element;
}

/** The key and readable name of a menu item, for other features that list menu items (folders). */
export function describeItem(element) {
    const key = keyOf(element, false);
    return { key, label: labelOf(element, key), icon: iconOf(element) };
}

/** CSS selector for the item with a key, as a direct child of a container. */
function itemSelector(key) {
    return /^(text|slot):/.test(key) ? `[${KEY_ATTR}="${CSS.escape(key)}"]` : `#${CSS.escape(key)}`;
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

// Generated rules per single container, and for the message buttons; joined into one stylesheet
const containerRules = new Map();
let messageRules = '';

function writeStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.append(style);
    }
    // Switched off: the page's own layout
    const text = isOn('layoutManager') ? [messageRules, ...containerRules.values()].filter(Boolean).join('\n') : '';
    if (style.textContent !== text) {
        style.textContent = text;
    }
}

/**
 * Keys of a container's children in page order (separators included, so they keep their
 * place). When several children share a key (a hidden copy of a menu item), the one shown
 * decides the place.
 */
function childKeys(container) {
    const children = [...container?.children ?? []];
    const keys = children.map(element => keyOf(element, false));
    const shown = withoutOwnRules(() => children.map(isDisplayed));
    const place = new Map();
    keys.forEach((key, index) => {
        if (!place.has(key) || (shown[index] && !shown[place.get(key)])) {
            place.set(key, index);
        }
    });
    return [...place.keys()].sort((a, b) => place.get(a) - place.get(b));
}

/**
 * Rules for one container. Block containers (the panel columns, the ≡ menu) become a column
 * flexbox only while reordered. `> *` on each item also reaches the real items inside the
 * `display: contents` wrappers extensions use (their own children keep their order among
 * themselves, since they all get the same value). Buttons sharing a spot get the same value
 * and so stay together in page order (script controls come right before Send / Stop).
 */
function applyContainer(selector) {
    const area = findArea(selector);
    if (!area?.crossMove) {
        applyOneContainer(selector);
        return;
    }
    if (!applyCrossArea(area)) {
        area.containers.forEach(({ selector: own }) => applyOneContainer(own));
    }
}

// The input box the two sides of the input bar sit around
const BAR_INPUT_ID = 'send_textarea';

/**
 * Items some extensions put right in the input bar, beside the input box, instead of in one
 * of its sides: each counts as an item of the side it shows on (before the input: the left
 * one, after it: the right one), at its place there.
 * @returns {{ element: HTMLElement, key: string, side: number, after: boolean }[]}
 */
function looseItems(parent, containers) {
    const sequence = withoutOwnRules(() => [...parent.children]
        .map((child, index) => ({ child, index, order: Number(getComputedStyle(child).order) || 0 }))
        .sort((a, b) => a.order - b.order || a.index - b.index)
        .map(entry => entry.child));
    const input = sequence.findIndex(child => child.id === BAR_INPUT_ID);
    if (input === -1) {
        return [];
    }
    const at = containers.map(container => sequence.indexOf(container));
    return sequence
        .map((child, index) => ({ child, index }))
        .filter(({ child, index }) => index !== input && !containers.includes(child) && isMeaningful(child) && !child.matches('script, style, template'))
        .map(({ child, index }) => {
            const side = index < input ? 0 : 1;
            return { element: child, key: keyOf(child, false), side, after: index > at[side] };
        });
}

/**
 * Where each item of an area whose items can change sides goes: the side whose saved order
 * lists it, else the side it is on in the page. Null when every item stays where the page has
 * it (then each side is arranged on its own, as any container), unless `always`.
 */
function crossState(area, { always = false } = {}) {
    if (!area?.crossMove) {
        return null;
    }
    const selectors = area.containers.map(container => container.selector);
    const containers = selectors.map(selector => document.querySelector(selector));
    const parent = containers[0]?.parentElement;
    if (!parent?.id || containers.some(container => container?.parentElement !== parent)) {
        return null;
    }
    const layouts = selectors.map(getLayout);
    const loose = looseItems(parent, containers);
    // Each side's items as the page has them, the loose ones at their places beside it
    const natural = containers.map((container, side) => [
        ...loose.filter(item => item.side === side && !item.after).map(item => item.key),
        ...childKeys(container),
        ...loose.filter(item => item.side === side && item.after).map(item => item.key),
    ]);
    const homeOf = (key) => {
        const saved = layouts.findIndex(layout => layout.order.includes(key));
        return saved === -1 ? natural.findIndex(keys => keys.includes(key)) : saved;
    };
    const ownKeys = containers.map(childKeys);
    // An item on the other side now, or a loose one the user arranged (its place or hiding)
    const moved = ownKeys.some((keys, index) => keys.some(key => homeOf(key) !== index))
        || loose.some(item => layouts.some(layout => layout.order.includes(item.key) || layout.hidden.includes(item.key)));
    return moved || always ? { selectors, containers, parent, layouts, natural, homeOf, loose } : null;
}

/** A side's items in their arranged order: its saved order first, then the rest as on the page. */
function crossOrder(state, index) {
    const { layouts, natural, homeOf } = state;
    const own = natural.flat().filter((key, at, all) => all.indexOf(key) === at && homeOf(key) === index);
    const order = layouts[index].order.filter(key => own.includes(key));
    return [...order, ...own.filter(key => !order.includes(key))];
}

/**
 * Items that changed sides. Nothing is moved in the page: both sides become `display: contents`,
 * so their buttons are laid out right in the bar around the input, and CSS `order` puts each
 * one in its side's block (the input keeps its place between them). The bar's spacing between
 * the sides and the input, and the sides' button alignment, are kept as the theme had them.
 */
function applyCrossArea(area) {
    const state = crossState(area);
    if (!state) {
        return false;
    }
    const { selectors, containers, parent } = state;
    const parentSelector = `#${CSS.escape(parent.id)}`;
    // Items are in a side or (loose ones) right in the bar
    const scope = `:is(${selectors.join(', ')}, ${parentSelector})`;
    const looseElements = state.loose.map(item => item.element);
    const measured = withoutOwnRules(() => {
        const style = getComputedStyle(parent);
        const children = [...parent.children].map((child, index) => ({ child, index, order: Number(getComputedStyle(child).order) || 0 }));
        return {
            gap: parseFloat(style.columnGap) || 0,
            sideGap: parseFloat(getComputedStyle(containers[0]).columnGap) || 0,
            align: getComputedStyle(containers[0]).alignItems,
            sequence: children.sort((a, b) => a.order - b.order || a.index - b.index),
            margins: new Map(children.map(({ child }) => [child, [parseFloat(getComputedStyle(child).marginLeft) || 0, parseFloat(getComputedStyle(child).marginRight) || 0]])),
            // A side's padding and margin together (the room it leaves at its edges)
            paddings: new Map([parent, ...containers].map((element) => {
                const style = getComputedStyle(element);
                const edge = side => (parseFloat(style[`padding${side}`]) || 0) + (element === parent ? 0 : parseFloat(style[`margin${side}`]) || 0);
                return [element, [edge('Left'), edge('Right')]];
            })),
            wrappers: new Set(containers.flatMap(container => [...container.children]).filter(child => getComputedStyle(child).display === 'contents')),
        };
    });
    // The buttons keep the sides' spacing (the bar takes the sides' gap); the sides' padding and
    // margin are kept at the bar's ends, and the input's distance to the sides as it was
    const padding = (element, end) => (containers.includes(element) ? measured.paddings.get(element)[end] : 0);
    const sequence = measured.sequence.map(entry => entry.child);
    const [barLeft, barRight] = measured.paddings.get(parent);
    // Margins of the bar's own children (the input): a first guess from the spacing rules, then
    // corrected by measuring (themes space the buttons in their own ways)
    const extra = new Map(measured.sequence.map(({ child }, at) => [child, [
        at > 0 ? measured.gap + padding(sequence[at - 1], 1) - measured.sideGap : 0,
        at < sequence.length - 1 ? measured.gap + padding(sequence[at + 1], 0) - measured.sideGap : 0,
    ]]));
    const write = () => {
        const rules = [
            `${selectors.join(', ')} { display: contents !important; }`,
            // The sides are at the bar's ends now (loose items have joined them)
            `${parentSelector} { column-gap: ${measured.sideGap}px !important; padding-left: ${barLeft + padding(containers[0], 0)}px !important; padding-right: ${barRight + padding(containers.at(-1), 1)}px !important; }`,
        ];
        if (measured.align && measured.align !== 'normal') {
            rules.push(`${scope} > * { align-self: ${measured.align}; }`);
        }
        let next = 0;
        measured.sequence.forEach(({ child, index }) => {
            const side = containers.indexOf(child);
            // Loose items take their order in their side's block
            if (looseElements.includes(child)) {
                return;
            }
            if (side === -1) {
                const [left, right] = measured.margins.get(child);
                const [before, after] = extra.get(child);
                rules.push(`${parentSelector} > :nth-child(${index + 1}) { order: ${next}; margin-left: ${left + before}px !important; margin-right: ${right + after}px !important; }`);
                next += 1;
                return;
            }
            const keys = crossOrder(state, side);
            // Items not in the list (shown only now and then) stay at the end of their own side
            rules.push(`${selectors[side]} > * { order: ${next + keys.length}; }`);
            keys.forEach((key, at) => {
                const members = spotMembers(key).map(member => `${scope} > ${itemSelector(member)}`);
                const inner = members.filter(item => [...measured.wrappers].some(wrapper => wrapper.matches(item))).map(item => `${item} > *`);
                rules.push(`${[...members, ...inner].join(', ')} { order: ${next + at}; }`);
            });
            next += keys.length + 1;
        });
        for (const layout of state.layouts) {
            for (const key of layout.hidden) {
                if (!lockedKeys.has(key)) {
                    rules.push(`${spotMembers(key).map(member => `${scope} > ${itemSelector(member)}`).join(', ')} { display: none !important; }`);
                }
            }
        }
        selectors.forEach((selector, index) => containerRules.set(selector, index === 0 ? rules.join('\n') : ''));
        writeStyles();
    };
    withoutTransitions(() => {
        const before = withoutOwnRules(() => sequence.map(child => distancesToButtons(child, containers, looseElements)));
        write();
        const after = sequence.map(child => distancesToButtons(child, containers, looseElements));
        let corrected = false;
        sequence.forEach((child, at) => {
            if (containers.includes(child) || looseElements.includes(child)) {
                return;
            }
            const margins = extra.get(child);
            [0, 1].forEach((end) => {
                // Small corrections only: a big difference means the bar is laid out differently
                // (buttons wrapped into rows before), not spaced differently
                const difference = before[at][end] !== null && after[at][end] !== null ? before[at][end] - after[at][end] : 0;
                if (Math.abs(difference) > 0.5 && Math.abs(difference) < 20) {
                    margins[end] += difference;
                    corrected = true;
                }
            });
        });
        if (corrected) {
            write();
        }
    });
    return true;
}

/**
 * Runs `measure` with every transition off (themes animate everything, sizes and margins too,
 * some with !important on classes: `:not(#…)` weighs as much as an id, so it still wins).
 */
function withoutTransitions(measure) {
    const style = document.createElement('style');
    style.textContent = ':not(#stqa_no_such_id) { transition: none !important; }';
    document.head.append(style);
    try {
        return measure();
    } finally {
        style.remove();
    }
}

/**
 * How far an element of the bar (the input) is from the nearest button shown on its left and
 * on its right (null where there is none). Buttons are the sides' items (and loose ones in the
 * bar), and the items inside wrappers without a box of their own.
 */
function distancesToButtons(element, containers, loose = []) {
    const box = element.getBoundingClientRect();
    const buttons = [...containers.flatMap(container => [...container.children]), ...loose]
        .flatMap(child => (getComputedStyle(child).display === 'contents' ? [...child.children] : [child]))
        .map(button => button.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.bottom > box.top && rect.top < box.bottom);
    const left = buttons.filter(rect => rect.right <= box.left + 1).map(rect => rect.right);
    const right = buttons.filter(rect => rect.left >= box.right - 1).map(rect => rect.left);
    return [left.length ? box.left - Math.max(...left) : null, right.length ? Math.min(...right) - box.right : null];
}

function applyOneContainer(selector) {
    const container = document.querySelector(selector);
    if (!container) {
        return;
    }
    const { order, hidden } = getLayout(selector);
    const keys = childKeys(container);
    const rules = [];
    if (order.length > 0) {
        const isBlock = withoutOwnRules(() => getComputedStyle(container).display === 'block');
        if (isBlock) {
            rules.push(`${selector} { display: flex !important; flex-direction: column; }`);
        }
        const full = arrange(order, keys);
        // A wrapper without a box of its own (display: contents) lays its children out in the
        // container: they take its place. Others keep their insides as they are (an icon
        // given an order would move past a name that is plain text).
        const wrappers = withoutOwnRules(() => new Set([...container.children]
            .filter(child => getComputedStyle(child).display === 'contents')));
        rules.push(`${selector} > * { order: ${full.length}; }`);
        full.forEach((key, index) => {
            const members = spotMembers(key).map(member => `${selector} > ${itemSelector(member)}`);
            const inner = members.filter(item => [...wrappers].some(wrapper => wrapper.matches(item))).map(item => `${item} > *`);
            rules.push(`${[...members, ...inner].join(', ')} { order: ${index}; }`);
        });
    }
    for (const key of hidden) {
        if (!lockedKeys.has(key)) {
            rules.push(`${spotMembers(key).map(member => `${selector} > ${itemSelector(member)}`).join(', ')} { display: none !important; }`);
        }
    }
    // A row of buttons that fills the screen width (Top Bar on phones): the ones left share the
    // room, so hiding some leaves no gap at one end
    if (hidden.length > 0 && findArea(selector)?.fillRow) {
        rules.push(`@media (max-width: 1000px) { ${selector} > * { flex: 1 1 0 !important; } }`);
    }
    containerRules.set(selector, rules.join('\n'));
    writeStyles();
}

/** Whether the page / theme displays the element (call inside `withoutOwnRules`). */
function isDisplayed(element) {
    return getComputedStyle(element).display !== 'none';
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
    const template = document.querySelector(`#message_template ${MESSAGE_ROW}`);
    const buttons = new Map();
    const add = (element, mustShow) => {
        const key = keyOf(element, true);
        const own = buttonClassOf(element) === key;
        // A spot shared by several buttons is shown with its main button when possible
        if (key && (!buttons.has(key) || (own && !buttons.get(key).own)) && (!mustShow || isDisplayed(element))) {
            buttons.set(key, { element, own });
        }
    };
    // Measured without this extension's rules, so buttons hidden here still count as available.
    // Drawn messages give what this theme shows; the template adds ST's buttons that show only
    // now and then (Jump to swipe history with several replies, Unhide on hidden messages...).
    withoutOwnRules(() => {
        rendered.flatMap(rowButtons).forEach(element => add(element, true));
        rowButtons(template).forEach(element => buttons.has(keyOf(element, true)) || add(element, false));
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
    messageRules = rules.join('\n');
    writeStyles();
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
        // The same order the stylesheet gives the messages (applyMessageStyles)
        const naturalKeys = naturalMessageKeys();
        const full = arrange(order, naturalKeys);
        const at = (list, key) => (list.includes(key) ? list.indexOf(key) : list.length);
        entries = messageButtons().map(({ key, element }) => ({
            key, element, sortIndex: natural ? at(naturalKeys, key) : at(full, key),
        }));
    } else if (crossState(findArea(selector), { always: true })) {
        // Sides of an area whose items can change sides: each lists the items it holds now
        // (loose items in the bar beside it included)
        const state = crossState(findArea(selector), { always: true });
        const side = state.selectors.indexOf(selector);
        const children = [...state.containers.flatMap(container => [...container.children]), ...state.loose.map(item => item.element)];
        const keys = children.map(element => keyOf(element, false));
        const shown = withoutOwnRules(() => children.map(child => isMeaningful(child) && isDisplayed(child)));
        const moved = crossState(findArea(selector));
        const full = natural ? state.natural[side] : moved ? crossOrder(state, side) : arrange(order, state.natural[side]);
        entries = full.filter(key => keys.some((other, index) => other === key && shown[index])).map((key, index) => ({
            key,
            element: children.find((child, at) => keys[at] === key && child.id === key && shown[at]) ?? children.find((child, at) => keys[at] === key && shown[at]),
            sortIndex: index,
        }));
    } else {
        const children = [...(document.querySelector(selector)?.children ?? [])];
        const keys = children.map(element => keyOf(element, false));
        // Only what the page shows (e.g. the hidden input-bar copies of Impersonate / Continue
        // stay out); a shared spot counts when any of its buttons shows, e.g. Stop while generating.
        // Measured without this extension's rules, so items hidden here still count.
        const shown = withoutOwnRules(() => children.map(child => isMeaningful(child) && isDisplayed(child)));
        const allKeys = childKeys(document.querySelector(selector));
        const listed = allKeys.filter(key => keys.some((other, index) => other === key && shown[index]));
        // The same order the stylesheet gives the page (applyContainer)
        const full = arrange(order, allKeys);
        entries = listed.map((key, index) => {
            // The spot's own button names it (Send rather than Stop), else the copy that shows
            const element = children.find((child, at) => keys[at] === key && child.id === key && shown[at])
                ?? children.find((child, at) => keys[at] === key && shown[at]);
            return { key, element, sortIndex: natural ? index : full.indexOf(key) };
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
export function saveLayout(selector, { order, hidden, listed = order }) {
    const natural = listItems(selector, { natural: true }).map(item => item.key);
    const unchanged = order.length === natural.length && order.every((key, index) => key === natural[index]);
    // Items hidden before that weren't listed this time (not on the page right now) stay hidden.
    // `listed`: every item the window showed (for sides items can move between, both sides'),
    // so one that went to the other side is that side's to hide.
    const kept = getLayout(selector).hidden.filter(key => !listed.includes(key));
    getSettings().layout[selector] = { order: unchanged ? [] : [...order], hidden: unique([...hidden, ...kept]).filter(key => !lockedKeys.has(key)) };
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
