// Extension settings within reach: an extension's settings (Tavern Helper, Regex...) added to the
// Options menu, the wand menu or the message menu (the shortcuts take them through their own
// "메뉴 항목 추가"). A tap shows those settings in a window of their own, unfolded: the settings
// themselves are moved into the window while it is up and put back where they were after, so
// they work as they always do (settings hidden in 메뉴 정리 included). An extension with tabs can
// be set to open on one tab, and each can have an icon of its own.
import { MODULE, getSettings, isOn } from './settings.js';
import { describeItem } from './layout-manager.js';

const TITLE = '편의성 모음';
const COLUMNS = ['#extensions_settings', '#extensions_settings2'];
export const FALLBACK_ICON = 'fa-solid fa-puzzle-piece';
const LINK_ATTR = 'data-stqa-link';
const MESSAGE_CLASS = 'stqa_link_mes';
const LAYOUT_STYLE_ID = 'stqa_layout_style';
const POPUP_HEAD_CLASS = 'stqa_ext_popup_head';

/** Where a link can go. */
export const LINK_PLACES = Object.freeze([
    { key: 'options', icon: 'fa-bars', label: '옵션 메뉴' },
    { key: 'wand', icon: 'fa-wand-magic-sparkles', label: '마법봉' },
    { key: 'message', icon: 'fa-message', label: '메시지 메뉴' },
]);

/** Icons to pick from (Font Awesome solid, which ST has built in). */
export const LINK_ICONS = Object.freeze([
    'fa-code', 'fa-terminal', 'fa-scroll', 'fa-file-lines', 'fa-book', 'fa-book-bookmark', 'fa-bookmark', 'fa-folder',
    'fa-wand-magic-sparkles', 'fa-brain', 'fa-robot', 'fa-language', 'fa-comments', 'fa-message', 'fa-feather', 'fa-pen',
    'fa-image', 'fa-images', 'fa-camera', 'fa-film', 'fa-palette', 'fa-masks-theater', 'fa-music', 'fa-volume-high',
    'fa-microphone', 'fa-gear', 'fa-sliders', 'fa-toolbox', 'fa-screwdriver-wrench', 'fa-filter', 'fa-magnifying-glass', 'fa-database',
    'fa-layer-group', 'fa-box-archive', 'fa-cubes', 'fa-puzzle-piece', 'fa-list-check', 'fa-chart-simple', 'fa-clock', 'fa-calendar',
    'fa-globe', 'fa-map', 'fa-user', 'fa-users', 'fa-ghost', 'fa-dice', 'fa-gamepad', 'fa-key',
    'fa-shield-halved', 'fa-tag', 'fa-star', 'fa-heart', 'fa-bolt', 'fa-fire', 'fa-flask', 'fa-lightbulb',
    'fa-rocket', 'fa-leaf', 'fa-moon', 'fa-sun',
].map(name => `fa-solid ${name}`));

// [{ key, label, icon, places: string[], tab: string }]
const links = () => (Array.isArray(getSettings().extensionLinkList) ? getSettings().extensionLinkList : []);
const linksAt = place => (isOn('extensionLinks') ? links().filter(link => link.places?.includes(place)) : []);
// Icons picked per extension: { key: classes }
const pickedIcons = () => getSettings().extensionIcons ?? {};

/** The icon an extension's links show: the one picked, else its own; '' when it has none. */
export function iconFor(key, ownIcon = '') {
    return pickedIcons()[key] || ownIcon || '';
}

/** A short id for a link, safe in ids and classes. */
function idOf(key) {
    let value = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        value = Math.imul(value ^ key.charCodeAt(i), 0x01000193);
    }
    return (value >>> 0).toString(36);
}

/** The first letter of a name (an emoji counts as one), shown where there is no icon. */
export function letterOf(label) {
    const text = String(label ?? '').trim();
    if (!text) {
        return '?';
    }
    const first = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(text)][0].segment : [...text][0];
    return first.toUpperCase();
}

// Size classes an icon may carry: the places size their icons themselves
const withoutSize = classes => classes.filter(name => !/^fa-(lg|xl|2xl|xs|sm|2xs|fw|\d+x)$/.test(name));

/** The drawer of an extension's settings, its header and its content (null if it has none). */
function drawerOf(element) {
    const drawer = element.matches('.inline-drawer') ? element : element.querySelector('.inline-drawer');
    const header = drawer?.querySelector('.inline-drawer-header, .inline-drawer-toggle');
    return header ? { drawer, header, content: drawer.querySelector(':scope > .inline-drawer-content') } : null;
}

/** Whether 메뉴 정리 hides it (its rule, not the extension's own styles). */
function hiddenByLayout(element) {
    if (getComputedStyle(element).display !== 'none') {
        return false;
    }
    const style = document.getElementById(LAYOUT_STYLE_ID);
    if (!style) {
        return false;
    }
    style.disabled = true;
    const shown = getComputedStyle(element).display !== 'none';
    style.disabled = false;
    return shown;
}

/** The extensions' settings on the page: [{ key, label, icon, element, hidden }], in page order. */
export function settingsOnPage() {
    const found = [];
    for (const selector of COLUMNS) {
        for (const element of document.querySelector(selector)?.children ?? []) {
            const parts = drawerOf(element);
            if (!parts) {
                continue;
            }
            const { key } = describeItem(element);
            // The name in the header, without the help mark some put after it
            const label = (parts.header.textContent.trim().split('\n')[0].trim().replace(/\s*\?$/, '') || key).slice(0, 40);
            const iconElement = parts.header.querySelector('[class*="fa-"]:not(.inline-drawer-icon):not([class*="question"])');
            const icon = iconElement ? withoutSize([...iconElement.classList].filter(name => name.startsWith('fa'))).join(' ') : '';
            found.push({ key, label, icon, element, hidden: hiddenByLayout(element) });
        }
    }
    return found;
}

/**
 * The tabs at the top of an extension's settings: a row of 2-8 alike, clickable items with short
 * names, exactly one of them marked as the one shown. Rows of option switches and of plain
 * buttons (a warning-colored one stands out the same way) are left out: a tab is tapped by itself.
 * @returns {{ name: string, element: Element }[] | null}
 */
function tabsOf(content) {
    for (const bar of content?.querySelectorAll('*') ?? []) {
        const kids = [...bar.children];
        if (kids.length < 2 || kids.length > 8 || bar.getAttribute('role') === 'radiogroup') {
            continue;
        }
        if (!kids.every(kid => kid.tagName === kids[0].tagName) || kids.some(kid => kid.matches('input, select, textarea, option'))) {
            continue;
        }
        const common = [...kids[0].classList].filter(name => kids.every(kid => kid.classList.contains(name)));
        if (!common.length && kids[0].tagName !== 'BUTTON') {
            continue;
        }
        const names = kids.map(kid => kid.textContent.trim().replace(/\s+/g, ' '));
        if (names.some(name => !name || name.length > 16) || new Set(names).size !== names.length) {
            continue;
        }
        if (!(kids[0].matches('button, a, [role="tab"]') || getComputedStyle(kids[0]).cursor === 'pointer')) {
            continue;
        }
        const own = kids.map(kid => [...kid.classList].filter(name => !common.includes(name) && kids.filter(other => other.classList.contains(name)).length === 1));
        const marked = kids.filter((kid, index) => kid.getAttribute('aria-selected') === 'true' || own[index].length);
        if (marked.length !== 1 || own[kids.indexOf(marked[0])].some(name => /warn|danger|red|caution|error|delete/i.test(name))) {
            continue;
        }
        return kids.map((element, index) => ({ name: names[index], element }));
    }
    return null;
}

/** Taps the tab an extension is set to open on (if it is there). */
function showPinnedTab(key, content) {
    const tab = links().find(link => link.key === key)?.tab;
    if (!tab || !isOn('extensionLinks')) {
        return;
    }
    tabsOf(content)?.find(entry => entry.name === tab)?.element.click();
}

// The settings shown in a window right now (one at a time)
let showing = null;

/** Shows one extension's settings in a window, unfolded (on its set tab); they go back after. */
export async function openExtensionLink(key, fallbackLabel = '') {
    if (showing) {
        return;
    }
    const found = settingsOnPage().find(entry => entry.key === key);
    if (!found) {
        const label = links().find(entry => entry.key === key)?.label || fallbackLabel || '?';
        toastr.warning(`"${label}" 설정을 찾지 못했습니다.`, TITLE);
        return;
    }
    // The Options menu closes the way its own button closes it
    const options = document.getElementById('options');
    if (options && options.style.display !== 'none' && options.offsetParent) {
        document.getElementById('options_button')?.click();
    }
    const { element, label } = found;
    const { header, content } = drawerOf(element);
    const parent = element.parentElement;
    const placeholder = document.createComment('stqa-extension-link');
    const contentStyle = content?.getAttribute('style') ?? null;
    const view = document.createElement('div');
    view.className = 'stqa_ext_popup';
    view.innerHTML = '<h3></h3>';
    view.querySelector('h3').textContent = label;
    showing = element;
    try {
        element.before(placeholder);
        view.append(element);
        // The window's title stands for the drawer's header, and the settings stay unfolded
        header.classList.add(POPUP_HEAD_CLASS);
        content && (content.style.display = 'block');
        showPinnedTab(key, content);
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        await new Popup(view, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true, leftAlign: true }).show();
    } finally {
        // Back where they were (the end of their column, should that spot be gone)
        placeholder.isConnected ? placeholder.replaceWith(element) : parent?.append(element);
        placeholder.remove();
        header.classList.remove(POPUP_HEAD_CLASS);
        if (content) {
            contentStyle === null ? content.removeAttribute('style') : content.setAttribute('style', contentStyle);
        }
        showing = null;
    }
}

/** An icon element's look: the icon's classes, or a letter for an extension with none. */
function dress(element, link, baseClass) {
    const icon = iconFor(link.key, link.icon);
    element.className = icon ? `${baseClass} ${icon}` : `${baseClass} stqa_link_letter`;
    element.textContent = icon ? '' : letterOf(link.label);
}

/** Menu entries (Options menu, wand menu): each place's container and how an entry looks. */
const MENUS = Object.freeze({
    options: {
        container: '#options .options-content',
        make(link) {
            const item = document.createElement('a');
            item.innerHTML = '<i></i><span></span>';
            dress(item.querySelector('i'), link, 'fa-lg');
            return item;
        },
    },
    wand: {
        container: '#extensionsMenu',
        make(link) {
            const item = document.createElement('div');
            item.className = 'list-group-item flex-container flexGap5 interactable';
            item.tabIndex = 0;
            item.innerHTML = '<div></div><span></span>';
            dress(item.querySelector('div'), link, 'extensionsMenuExtensionButton');
            return item;
        },
    },
});

// How an entry looks, to make it again when that changes (another icon picked)
const lookOf = link => `${iconFor(link.key, link.icon)}|${link.label}`;

function syncMenu(place) {
    const { container, make } = MENUS[place];
    const menu = document.querySelector(container);
    if (!menu) {
        return;
    }
    const wanted = linksAt(place);
    const idFor = link => `stqa_link_${place[0]}_${idOf(link.key)}`;
    const looks = new Map(wanted.map(link => [idFor(link), lookOf(link)]));
    menu.querySelectorAll(`:scope > [${LINK_ATTR}]`).forEach(item => looks.get(item.id) === item.dataset.look || item.remove());
    for (const link of wanted) {
        if (document.getElementById(idFor(link))) {
            continue;
        }
        const item = make(link);
        item.id = idFor(link);
        item.dataset.look = lookOf(link);
        item.setAttribute(LINK_ATTR, link.key);
        // Names come from other extensions: set as text
        item.querySelector('span').textContent = link.label;
        menu.append(item);
    }
}

/** A message menu button for a link (the message menu shows icons only: a letter when there is none). */
function messageButton(link) {
    const button = document.createElement('div');
    // Its own class first: 메뉴 정리 tells message buttons apart by their first class
    dress(button, link, `mes_button stqa_link_m_${idOf(link.key)} ${MESSAGE_CLASS}`);
    button.title = link.label;
    button.dataset.look = lookOf(link);
    button.setAttribute(LINK_ATTR, link.key);
    return button;
}

function syncMessageButtons() {
    const wanted = linksAt('message');
    const looks = new Map(wanted.map(link => [`stqa_link_m_${idOf(link.key)}`, lookOf(link)]));
    document.querySelectorAll('#message_template .extraMesButtons, #chat .mes .extraMesButtons').forEach((box) => {
        box.querySelectorAll(`:scope > .${MESSAGE_CLASS}`).forEach((button) => {
            const own = [...button.classList].find(name => looks.has(name));
            own && looks.get(own) === button.dataset.look || button.remove();
        });
        for (const link of wanted) {
            box.querySelector(`:scope > .stqa_link_m_${idOf(link.key)}`) || box.append(messageButton(link));
        }
    });
}

/** Puts the links where they were chosen to go (and takes away the rest). */
export function applyExtensionLinks() {
    syncMenu('options');
    syncMenu('wand');
    syncMessageButtons();
}

/**
 * Picks an icon from the built-in ones ('' = the extension's own, or its first letter).
 * @returns {Promise<string|null>} the classes, '' for the default, null if nothing was picked
 */
async function pickIcon(label) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const root = document.createElement('div');
    root.className = 'stqa_icon_pick';
    root.innerHTML = '<h3></h3><div class="stqa_icon_grid"></div>';
    root.querySelector('h3').textContent = label;
    const grid = root.querySelector('.stqa_icon_grid');
    let picked = null;
    const popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '취소' });
    for (const icon of ['', ...LINK_ICONS]) {
        const cell = document.createElement('div');
        cell.className = icon ? `stqa_icon_cell ${icon}` : 'stqa_icon_cell stqa_icon_default';
        icon || (cell.textContent = '기본');
        cell.addEventListener('click', () => {
            picked = icon;
            popup.complete(0);
        });
        grid.append(cell);
    }
    await popup.show();
    return picked;
}

/**
 * Picks, for each extension's settings, where a link to them goes, its icon and the tab they
 * open on.
 * @returns {Promise<boolean>} whether anything changed
 */
export async function pickExtensionLinks() {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const settings = getSettings();
    const onPage = settingsOnPage();
    if (!onPage.length) {
        toastr.info('확장 설정이 없습니다.', TITLE);
        return false;
    }
    const saved = new Map(links().map(link => [link.key, link]));
    const icons = { ...pickedIcons() };
    const root = document.createElement('div');
    root.className = 'stqa_panel stqa_link_pick';
    root.innerHTML = '<h3>확장 설정 바로가기</h3><div class="stqa_link_grid"><span></span></div>';
    const grid = root.querySelector('.stqa_link_grid');
    for (const place of LINK_PLACES) {
        const head = document.createElement('i');
        head.className = `fa-solid ${place.icon} stqa_link_head`;
        head.title = place.label;
        grid.append(head);
    }
    const tabChoices = new Map();
    for (const entry of onPage) {
        const name = document.createElement('span');
        name.className = 'stqa_link_name';
        // The icon its links show: tap to pick another
        const iconButton = document.createElement('span');
        const drawIcon = () => dress(iconButton, { key: entry.key, label: entry.label, icon: icons[entry.key] || entry.icon }, 'stqa_link_icon');
        drawIcon();
        iconButton.title = '아이콘 고르기';
        iconButton.addEventListener('click', async () => {
            const icon = await pickIcon(entry.label);
            if (icon === null) {
                return;
            }
            icon ? (icons[entry.key] = icon) : delete icons[entry.key];
            drawIcon();
        });
        const text = document.createElement('span');
        text.className = 'stqa_link_label';
        text.textContent = entry.label;
        name.append(iconButton, text);
        if (entry.hidden) {
            // Hidden in 메뉴 정리: still reachable through a link
            const mark = document.createElement('i');
            mark.className = 'fa-solid fa-eye-slash stqa_link_hidden';
            mark.title = '메뉴 정리에서 숨김';
            name.append(mark);
        }
        grid.append(name);
        for (const place of LINK_PLACES) {
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.title = place.label;
            box.dataset.key = entry.key;
            box.dataset.place = place.key;
            box.checked = Boolean(saved.get(entry.key)?.places?.includes(place.key));
            grid.append(box);
        }
        const tabs = tabsOf(drawerOf(entry.element).content);
        const pinned = saved.get(entry.key)?.tab ?? '';
        if (tabs || pinned) {
            const select = document.createElement('select');
            select.className = 'text_pole stqa_link_tab';
            select.append(new Option('처음 탭: 그대로', ''));
            for (const tab of new Set([...(tabs ?? []).map(item => item.name), ...(pinned ? [pinned] : [])])) {
                select.append(new Option(`처음 탭: ${tab}`, tab, false, tab === pinned));
            }
            tabChoices.set(entry.key, select);
            grid.append(select);
        }
    }
    const result = await new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소', leftAlign: true }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return false;
    }
    const chosen = onPage.map(entry => ({
        key: entry.key,
        label: entry.label,
        icon: entry.icon,
        places: [...root.querySelectorAll('input:checked')].filter(box => box.dataset.key === entry.key).map(box => box.dataset.place),
        tab: tabChoices.get(entry.key)?.value ?? '',
    })).filter(link => link.places.length || link.tab);
    // Links to settings not on the page right now (an extension switched off) stay
    const listed = new Set(onPage.map(entry => entry.key));
    settings.extensionLinkList = [...links().filter(link => !listed.has(link.key)), ...chosen];
    settings.extensionIcons = icons;
    SillyTavern.getContext().saveSettingsDebounced();
    applyExtensionLinks();
    return true;
}

export function initExtensionLinks() {
    document.addEventListener('click', (event) => {
        const item = event.target.closest?.(`[${LINK_ATTR}]`);
        if (item && isOn('extensionLinks')) {
            openExtensionLink(item.getAttribute(LINK_ATTR)).catch(error => console.error(`[${MODULE}] Extension link failed`, error));
        }
    });
    // An extension's settings unfolded by hand in the Extensions drawer open on their set tab
    document.addEventListener('click', (event) => {
        // Only an extension's own header in the Extensions drawer (not world info entries and the like)
        const header = event.target.closest?.('#extensions_settings .inline-drawer-header, #extensions_settings .inline-drawer-toggle, #extensions_settings2 .inline-drawer-header, #extensions_settings2 .inline-drawer-toggle');
        if (!header || !isOn('extensionLinks') || !links().some(link => link.tab)) {
            return;
        }
        const element = [...header.closest('#extensions_settings, #extensions_settings2').children].find(child => child.contains(header));
        const parts = element && drawerOf(element);
        if (!parts?.content || parts.header !== header) {
            return;
        }
        const { key } = describeItem(element);
        if (links().some(link => link.key === key && link.tab)) {
            // After ST has unfolded it (the tap reaches ST's own handler first)
            setTimeout(() => getComputedStyle(parts.content).display !== 'none' && showPinnedTab(key, parts.content), 50);
        }
    });
    // Messages drawn from the template carry the buttons; ones drawn before (or re-drawn by
    // another extension) get them on the next render
    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const type of [eventTypes.CHAT_CHANGED, eventTypes.MORE_MESSAGES_LOADED, eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED]) {
        type && eventSource.on(type, () => linksAt('message').length && syncMessageButtons());
    }
    // Extensions add their menu entries and settings at different times
    eventSource.on(eventTypes.APP_READY, applyExtensionLinks);
    applyExtensionLinks();
}
