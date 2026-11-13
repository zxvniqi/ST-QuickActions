// Extension settings within reach: an extension's settings (Tavern Helper, Regex...) added to the
// Options menu, the wand menu or the message menu (the shortcuts take them through their own
// "메뉴 항목 추가"). A tap opens the Extensions drawer right at those settings, unfolded, with no
// scrolling through the whole list; settings hidden in 메뉴 정리 are shown for that visit.
// An extension with tabs can also be set to open on one tab.
import { MODULE, getSettings, isOn } from './settings.js';
import { describeItem } from './layout-manager.js';

const TITLE = '편의성 모음';
const COLUMNS = ['#extensions_settings', '#extensions_settings2'];
export const FALLBACK_ICON = 'fa-solid fa-puzzle-piece';
const LINK_ATTR = 'data-stqa-link';
const MESSAGE_CLASS = 'stqa_link_mes';
const REVEAL_ATTR = 'data-stqa-revealed';
const LAYOUT_STYLE_ID = 'stqa_layout_style';

/** Where a link can go. */
export const LINK_PLACES = Object.freeze([
    { key: 'options', icon: 'fa-bars', label: '옵션 메뉴' },
    { key: 'wand', icon: 'fa-wand-magic-sparkles', label: '마법봉' },
    { key: 'message', icon: 'fa-message', label: '메시지 메뉴' },
]);

// [{ key, label, icon, places: string[], tab: string }]
const links = () => (Array.isArray(getSettings().extensionLinkList) ? getSettings().extensionLinkList : []);
const linksAt = place => (isOn('extensionLinks') ? links().filter(link => link.places?.includes(place)) : []);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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

/** Hidden in 메뉴 정리 (its own rule, not the extension's): what display it has without that rule. */
function hiddenByLayout(element) {
    if (getComputedStyle(element).display !== 'none' || element.hasAttribute(REVEAL_ATTR)) {
        return null;
    }
    const style = document.getElementById(LAYOUT_STYLE_ID);
    if (!style) {
        return null;
    }
    style.disabled = true;
    const display = getComputedStyle(element).display;
    style.disabled = false;
    return display === 'none' ? null : display;
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
            found.push({ key, label, icon, element, hidden: Boolean(hiddenByLayout(element)) });
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

/** Taps the tab an extension is set to open on (if it is there and not shown already). */
function showPinnedTab(key, content) {
    const tab = links().find(link => link.key === key)?.tab;
    if (!tab || !isOn('extensionLinks')) {
        return;
    }
    tabsOf(content)?.find(entry => entry.name === tab)?.element.click();
}

/** Settings shown for one visit although hidden in 메뉴 정리: hidden again when the drawer closes. */
function hideRevealed() {
    document.querySelectorAll(`[${REVEAL_ATTR}]`).forEach((element) => {
        element.style.removeProperty('display');
        element.removeAttribute(REVEAL_ATTR);
    });
}

/** Opens the Extensions drawer at one extension's settings, unfolded (on its set tab). */
export async function openExtensionLink(key, fallbackLabel = '') {
    const found = settingsOnPage().find(entry => entry.key === key);
    if (!found) {
        const label = links().find(entry => entry.key === key)?.label || fallbackLabel || '?';
        toastr.warning(`"${label}" 설정을 찾지 못했습니다.`, TITLE);
        return;
    }
    const { element } = found;
    // The Options menu closes the way its own button closes it
    const options = document.getElementById('options');
    if (options && options.style.display !== 'none' && options.offsetParent) {
        document.getElementById('options_button')?.click();
    }
    hideRevealed();
    const display = hiddenByLayout(element);
    if (display) {
        // Inline and important: over the 메뉴 정리 rule, for this visit only
        element.style.setProperty('display', display, 'important');
        element.setAttribute(REVEAL_ATTR, '');
    }
    const block = document.getElementById('rm_extensions_block');
    if (block && !block.classList.contains('openDrawer')) {
        document.querySelector('#extensions-settings-button .drawer-toggle')?.click();
    }
    const { drawer, header, content } = drawerOf(element);
    if (content && getComputedStyle(content).display === 'none') {
        header.click();
    } else {
        showPinnedTab(key, content);
    }
    // After the drawers have opened; settings above may still be growing (unfolding, drawn late),
    // so it is put at the top again a few times, unless the user has touched it since
    let touched = false;
    const stop = () => (touched = true);
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    events.forEach(type => block?.addEventListener(type, stop, { passive: true }));
    try {
        await wait(350);
        for (let i = 0; i < 4 && !touched; i++) {
            // The drawer itself (a container may have no box of its own: display: contents), put
            // at the top of the Extensions drawer's own scrolling (scrollIntoView can tuck it
            // under the top bar)
            block
                ? (block.scrollTop += drawer.getBoundingClientRect().top - block.getBoundingClientRect().top)
                : drawer.scrollIntoView({ block: 'start' });
            await wait(250);
        }
    } finally {
        events.forEach(type => block?.removeEventListener(type, stop));
    }
}

/** Menu entries (Options menu, wand menu): each place's container and how an entry looks. */
const MENUS = Object.freeze({
    options: {
        container: '#options .options-content',
        make(link) {
            const item = document.createElement('a');
            item.innerHTML = '<i></i><span></span>';
            item.querySelector('i').className = `fa-lg ${link.icon || FALLBACK_ICON}`;
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
            item.querySelector('div').className = `${link.icon || FALLBACK_ICON} extensionsMenuExtensionButton`;
            return item;
        },
    },
});

function syncMenu(place) {
    const { container, make } = MENUS[place];
    const menu = document.querySelector(container);
    if (!menu) {
        return;
    }
    const wanted = linksAt(place);
    const idFor = link => `stqa_link_${place[0]}_${idOf(link.key)}`;
    const ids = new Set(wanted.map(idFor));
    menu.querySelectorAll(`:scope > [${LINK_ATTR}]`).forEach(item => ids.has(item.id) || item.remove());
    for (const link of wanted) {
        if (document.getElementById(idFor(link))) {
            continue;
        }
        const item = make(link);
        item.id = idFor(link);
        item.setAttribute(LINK_ATTR, link.key);
        // Names come from other extensions: set as text
        item.querySelector('span').textContent = link.label;
        menu.append(item);
    }
}

/** A message menu button for a link (the message menu shows icons only: a letter when there is none). */
function messageButton(link) {
    const button = document.createElement('div');
    const ownClass = `stqa_link_m_${idOf(link.key)}`;
    button.className = link.icon
        ? `mes_button ${MESSAGE_CLASS} ${ownClass} ${link.icon}`
        : `mes_button ${MESSAGE_CLASS} ${ownClass} stqa_link_letter`;
    link.icon || (button.textContent = letterOf(link.label));
    button.title = link.label;
    button.setAttribute(LINK_ATTR, link.key);
    return button;
}

function syncMessageButtons() {
    const wanted = linksAt('message');
    const classes = new Set(wanted.map(link => `stqa_link_m_${idOf(link.key)}`));
    document.querySelectorAll('#message_template .extraMesButtons, #chat .mes .extraMesButtons').forEach((box) => {
        box.querySelectorAll(`:scope > .${MESSAGE_CLASS}`).forEach((button) => {
            [...button.classList].some(name => classes.has(name)) || button.remove();
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
    isOn('extensionLinks') || hideRevealed();
}

/**
 * Picks, for each extension's settings, where a link to them goes and the tab they open on.
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
        name.textContent = entry.label;
        if (entry.hidden) {
            // Hidden in 메뉴 정리: still reachable through a link
            const mark = document.createElement('i');
            mark.className = 'fa-solid fa-eye-slash stqa_link_hidden';
            mark.title = '메뉴 정리에서 숨김';
            name.prepend(mark);
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
            for (const tab of new Set([...(tabs ?? []).map(entry => entry.name), ...(pinned ? [pinned] : [])])) {
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
    // An extension's settings unfolded (by a link or by hand) open on their set tab
    document.addEventListener('click', (event) => {
        const header = event.target.closest?.('.inline-drawer-header, .inline-drawer-toggle');
        if (!header || !links().some(link => link.tab) || !isOn('extensionLinks')) {
            return;
        }
        const entry = settingsOnPage().find(({ element }) => drawerOf(element)?.header === header);
        const content = entry && drawerOf(entry.element).content;
        if (content && links().some(link => link.key === entry.key && link.tab)) {
            // After ST has unfolded it (the tap reaches ST's own handler first)
            setTimeout(() => getComputedStyle(content).display !== 'none' && showPinnedTab(entry.key, content), 50);
        }
    });
    // Settings shown for a link's visit go back to hidden once the Extensions drawer closes
    const block = document.getElementById('rm_extensions_block');
    block && new MutationObserver(() => block.classList.contains('openDrawer') || hideRevealed())
        .observe(block, { attributes: true, attributeFilter: ['class'] });
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
