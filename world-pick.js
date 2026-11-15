// World info, easier to pick. The editor's dropdown opens a window instead of the browser's
// long list: a search box, every world or only the ones starred (즐겨찾기), in ST's order or the
// ones looked at lately first, and under each name the characters it is linked to as small round
// avatars. Tapping an avatar goes to that character (or, for a world bound to a chat, to that
// chat). Chats are known once they were opened with the feature on: ST keeps a chat's world
// inside the chat's own file, so there is no list of them to read.
import { MODULE, getSettings, isOn } from './settings.js';

const TITLE = '편의성 모음';
const SELECT = '#world_editor_select';
// Worlds remembered as looked at lately
const RECENT_MAX = 40;
const ON_CLASS = 'stqa_world_pick_on';
const MAX_AVATARS = 8;

let wi = null;
try {
    wi = await import('../../../world-info.js');
} catch (error) {
    console.warn(`[${MODULE}] World info not available; its picker is off`, error);
}

const worldNames = () => (Array.isArray(wi?.world_names) ? wi.world_names : []);
const favorites = () => (Array.isArray(getSettings().worldFavorites) ? getSettings().worldFavorites : (getSettings().worldFavorites = []));
// Chats bound to a world, as they were seen: { world: [{ avatar, chat }] }
const chatIndex = () => (getSettings().worldChats ??= {});
const save = () => SillyTavern.getContext().saveSettingsDebounced();

/** Every world's characters: Map(world → [{ avatar, name, chat? }]), a character once per world. */
function linksByWorld() {
    const context = SillyTavern.getContext();
    const links = new Map();
    const add = (world, entry) => {
        if (!world) {
            return;
        }
        const list = links.get(world) ?? links.set(world, []).get(world);
        list.some(other => other.avatar === entry.avatar && other.chat === entry.chat) || list.push(entry);
    };
    // A character's extra books are kept under its file name without the extension
    const extra = new Map((wi?.world_info?.charLore ?? []).map(entry => [entry.name, entry.extraBooks ?? []]));
    const known = new Map();
    for (const character of context.characters ?? []) {
        if (!character?.avatar) {
            continue;
        }
        known.set(character.avatar, character.name);
        const entry = { avatar: character.avatar, name: character.name };
        add(character.data?.extensions?.world, entry);
        for (const world of extra.get(character.avatar.replace(/\.[^.]+$/, '')) ?? []) {
            add(world, entry);
        }
    }
    // Chats bound to a world (of characters still there)
    for (const [world, chats] of Object.entries(chatIndex())) {
        for (const { avatar, chat } of chats) {
            known.has(avatar) && add(world, { avatar, name: known.get(avatar), chat });
        }
    }
    return links;
}

/** The Extensions-style drawer of world info closes (the chat is about to change under it). */
function closeWorldDrawer() {
    const drawer = document.querySelector('#WI-SP-button .drawer-content');
    if (drawer?.classList.contains('openDrawer') && !drawer.classList.contains('pinnedOpen')) {
        document.querySelector('#WI-SP-button .drawer-toggle')?.click();
    }
}

/** Goes to a linked character (its latest chat), or to the chat a world is bound to. */
async function goTo(entry, close) {
    const context = SillyTavern.getContext();
    const index = context.characters.findIndex(character => character.avatar === entry.avatar);
    if (index === -1) {
        toastr.warning('캐릭터를 찾지 못했습니다.', TITLE);
        return;
    }
    if (document.getElementById('mes_stop')?.offsetParent) {
        toastr.info('답변을 만드는 중에는 이동할 수 없습니다.', TITLE);
        return;
    }
    close?.();
    closeWorldDrawer();
    if (String(context.characterId) !== String(index) || context.groupId) {
        await context.selectCharacterById(index);
    }
    if (entry.chat && SillyTavern.getContext().getCurrentChatId() !== entry.chat && typeof context.openCharacterChat === 'function') {
        await context.openCharacterChat(entry.chat);
    }
}

/** A world's linked characters as small round avatars (the first few, then +n). */
function avatarRow(entries, close) {
    const row = document.createElement('div');
    row.className = 'stqa_world_avatars';
    const context = SillyTavern.getContext();
    for (const entry of entries.slice(0, MAX_AVATARS)) {
        const item = document.createElement('span');
        item.className = `stqa_world_avatar${entry.chat ? ' stqa_world_chat' : ''}`;
        item.title = entry.chat ? `${entry.name} · ${entry.chat}` : entry.name;
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = context.getThumbnailUrl('avatar', entry.avatar);
        item.append(image);
        // Bound to one chat (not the whole character): marked
        entry.chat && item.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-comment"></i>');
        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            goTo(entry, close).catch(error => console.error(`[${MODULE}] Going to a linked character failed`, error));
        });
        row.append(item);
    }
    if (entries.length > MAX_AVATARS) {
        const more = document.createElement('span');
        more.className = 'stqa_world_more';
        more.textContent = `+${entries.length - MAX_AVATARS}`;
        row.append(more);
    }
    return row;
}

const currentWorld = () => {
    const select = document.querySelector(SELECT);
    const option = select?.selectedOptions[0];
    return option && option.value !== '' ? option.textContent.trim() : '';
};

/** Picks a world in the editor the way its dropdown does ('' closes the editor). */
function pick(name) {
    const index = name ? worldNames().indexOf(name) : -1;
    $(SELECT).val(index === -1 ? '' : String(index)).trigger('change');
}

const recent = () => (Array.isArray(getSettings().worldRecent) ? getSettings().worldRecent : (getSettings().worldRecent = []));

/** The world opened in the editor goes to the front of the ones looked at lately. */
function noteOpened() {
    const world = currentWorld();
    if (!world || !isOn('worldPicker') || recent()[0] === world) {
        return;
    }
    getSettings().worldRecent = [world, ...recent().filter(name => name !== world)].slice(0, RECENT_MAX);
    save();
}

/** The worlds in the order chosen: ST's own, or the ones looked at lately first. */
function ordered(names) {
    if (getSettings().worldSort !== 'recent') {
        return names;
    }
    const rank = new Map(recent().map((name, index) => [name, index]));
    return [...names].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
}

async function openPicker() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    // The open chat may have been bound to a world since it was opened
    noteChatWorld();
    const links = linksByWorld();
    const current = currentWorld();
    const root = document.createElement('div');
    root.className = 'stqa_world_pick';
    root.innerHTML = `
        <div class="stqa_world_top">
            <div class="stqa_panel_search"><i class="fa-solid fa-magnifying-glass"></i><input class="text_pole" type="search" placeholder="월드인포 찾기"></div>
            <div class="menu_button stqa_world_sort fa-solid"></div>
        </div>
        <div class="stqa_tabs"><div class="stqa_tab" data-tab="all">전체</div><div class="stqa_tab" data-tab="fav"><i class="fa-solid fa-star"></i> 즐겨찾기</div></div>
        <div class="stqa_world_list"></div>`;
    const sort = root.querySelector('.stqa_world_sort');
    const list = root.querySelector('.stqa_world_list');
    const search = root.querySelector('input');
    let tab = 'all';
    let popup = null;
    const close = () => popup?.complete(null);
    const render = () => {
        const term = search.value.trim().toLowerCase();
        const stars = new Set(favorites());
        root.querySelectorAll('.stqa_tab').forEach(item => item.classList.toggle('stqa_tab_active', item.dataset.tab === tab));
        // The order in use: ST's own (by name), or the ones looked at lately first
        const byRecent = getSettings().worldSort === 'recent';
        sort.classList.toggle('fa-clock-rotate-left', byRecent);
        sort.classList.toggle('fa-arrow-down-a-z', !byRecent);
        sort.title = byRecent ? '최근 본 순 (누르면 기본 순)' : '기본 순 (누르면 최근 본 순)';
        const shown = ordered(worldNames()).filter(name => (tab === 'all' || stars.has(name)) && (!term || name.toLowerCase().includes(term)));
        list.replaceChildren(...shown.map((name) => {
            const row = document.createElement('div');
            row.className = `stqa_world_row${name === current ? ' stqa_active' : ''}`;
            row.innerHTML = '<div class="stqa_world_text"><span class="stqa_world_name"></span></div><i class="stqa_world_star fa-star"></i>';
            const star = row.querySelector('.stqa_world_star');
            star.classList.add(stars.has(name) ? 'fa-solid' : 'fa-regular');
            star.classList.toggle('stqa_starred', stars.has(name));
            star.title = '즐겨찾기';
            // Names come from files: set as text
            row.querySelector('.stqa_world_name').textContent = name;
            const entries = links.get(name);
            entries?.length && row.querySelector('.stqa_world_text').append(avatarRow(entries, close));
            star.addEventListener('click', (event) => {
                event.stopPropagation();
                const kept = favorites().filter(other => other !== name);
                getSettings().worldFavorites = stars.has(name) ? kept : [...kept, name];
                save();
                render();
            });
            row.addEventListener('click', () => {
                pick(name);
                close();
            });
            return row;
        }));
        if (!shown.length) {
            list.innerHTML = `<div class="stqa_hint">${tab === 'fav' && !term ? '★ 를 눌러 즐겨찾기에 넣으세요.' : '없습니다.'}</div>`;
        }
    };
    root.querySelectorAll('.stqa_tab').forEach(item => item.addEventListener('click', () => {
        tab = item.dataset.tab;
        render();
    }));
    search.addEventListener('input', render);
    sort.addEventListener('click', () => {
        getSettings().worldSort = getSettings().worldSort === 'recent' ? 'default' : 'recent';
        save();
        render();
        list.scrollTop = 0;
    });
    render();
    popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '닫기' });
    const shown = popup.show();
    // The world in use comes into view
    setTimeout(() => list.querySelector('.stqa_active')?.scrollIntoView({ block: 'center' }));
    await shown;
}

/** The chat just opened: which world it is bound to is noted (and a binding gone, forgotten). */
function noteChatWorld() {
    const context = SillyTavern.getContext();
    const chat = context.getCurrentChatId();
    const avatar = context.groupId ? null : context.characters[context.characterId]?.avatar;
    if (!chat || !avatar || !isOn('worldPicker')) {
        return;
    }
    const world = context.chatMetadata?.world_info ?? '';
    const index = chatIndex();
    let changed = false;
    for (const [name, chats] of Object.entries(index)) {
        const kept = chats.filter(entry => !(entry.avatar === avatar && entry.chat === chat) || name === world);
        if (kept.length !== chats.length) {
            kept.length ? (index[name] = kept) : delete index[name];
            changed = true;
        }
    }
    if (world && !index[world]?.some(entry => entry.avatar === avatar && entry.chat === chat)) {
        (index[world] ??= []).push({ avatar, chat });
        changed = true;
    }
    changed && save();
}

export function applyWorldPicker() {
    document.body.classList.toggle(ON_CLASS, Boolean(wi) && isOn('worldPicker'));
}

export function initWorldPicker() {
    const select = document.querySelector(SELECT);
    if (!wi || !select) {
        return;
    }
    // The dropdown itself takes no taps while on (CSS): a tap on it, or on the box ST puts in its
    // place on a computer, opens the window
    select.parentElement.addEventListener('click', (event) => {
        if (!isOn('worldPicker')) {
            return;
        }
        const boxes = [select, select.nextElementSibling?.classList.contains('select2') ? select.nextElementSibling : null].filter(Boolean);
        const hit = boxes.some((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        });
        if (hit) {
            event.preventDefault();
            event.stopPropagation();
            openPicker().catch(error => console.error(`[${MODULE}] World picker failed`, error));
        }
    }, true);
    // ST picks worlds through jQuery, which only its own listeners hear
    $(select).on('change', () => setTimeout(noteOpened));
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, noteChatWorld);
    eventSource.on(eventTypes.APP_READY, applyWorldPicker);
    applyWorldPicker();
}
