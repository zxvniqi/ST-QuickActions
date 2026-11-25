// Personas, easier to find in a long list:
//  - a memo per persona, shown in the list in place of the first lines of its description
//    (typed in a box by the persona's name; the search finds it too),
//  - the characters a persona is connected to (ST's connections, and chats held to it with ST's
//    persona lock), as small round avatars by its name,
//  - folders: chips over the list show one folder's personas (ST's own search, order and pages
//    keep working on what is shown); in a chat, a chip of its character shows the personas
//    connected to it (both ways).
// ST's list is drawn page by page, so the folder is applied where ST filters the list, and the
// memo and avatars are put on each row as ST draws it.
import { MODULE, getSettings, isOn } from './settings.js';
import { ownChatDelete } from './message-trash.js';

const LIST = '#user_avatar_block';
const BAR_ID = 'stqa_persona_folders';
const MEMO_ID = 'stqa_persona_memo';
const MAX_AVATARS = 5;
// Personas in no folder
const LOOSE = 'none';
// Personas connected to the character (or group) of the open chat
const HERE = 'here';

let personas = null;
let power = null;
try {
    personas = await import('../../../personas.js');
    power = (await import('../../../power-user.js')).power_user;
} catch (error) {
    console.warn(`[${MODULE}] Personas not available; their tools are off`, error);
}

const memos = () => (getSettings().personaMemos ??= {});
// [{ id, name, keys: avatar ids }] (a persona is in one folder at most)
const folders = () => (Array.isArray(getSettings().personaFolders) ? getSettings().personaFolders : (getSettings().personaFolders = []));
const save = () => SillyTavern.getContext().saveSettingsDebounced();
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The folder on show (null: every persona); not kept, the list starts whole
let shownFolder = null;

/**
 * ST's list drawn again for what is on show now, from its first page: ST reopens the page it was
 * on, and a page past the end of a shorter list (a folder, the chat's chip) draws nothing.
 */
function redrawList() {
    try {
        $('#persona_pagination_container').pagination('go', 1);
    } catch {
        // No pages drawn yet
    }
    return personas?.getUserAvatars?.(true)?.catch?.(error => console.error(`[${MODULE}] Persona list failed`, error));
}

/* ---------- chats held to a persona (ST's persona lock on a chat) ---------- */

// { [character avatar]: { [chat file]: persona id } }: worked out from the chats themselves, so kept
// on this device only (in the settings it would grow them and make every device save them over each
// other's). Filled by reading every character's chat list now and then, kept up as chats are opened.
const LINKS_KEY = 'stqa_persona_chat_links';
const DAY = 24 * 60 * 60 * 1000;
const RESCAN_MS = 7 * DAY;
const SCAN_AT_ONCE = 2;
const stripJsonl = name => String(name ?? '').replace(/\.jsonl$/, '');

// { at: when every chat was last read, links }
let localLinks = null;
let linksTimer = null;

function chatLinks() {
    if (!localLinks) {
        try {
            const stored = JSON.parse(localStorage.getItem(LINKS_KEY) ?? 'null');
            localLinks = stored?.links && typeof stored.links === 'object' ? stored : null;
        } catch {
            localLinks = null;
        }
        localLinks ??= { at: 0, links: {} };
        // Kept in the settings before: taken from there once, and the settings let go of it
        const settings = getSettings();
        if (settings.personaChatLinks || settings.personaChatScanAt) {
            Object.keys(localLinks.links).length || !settings.personaChatLinks || typeof settings.personaChatLinks !== 'object' || (localLinks = { at: Number(settings.personaChatScanAt) || 0, links: settings.personaChatLinks });
            delete settings.personaChatLinks;
            delete settings.personaChatScanAt;
            save();
            saveLinks();
        }
    }
    return localLinks.links;
}

/** Written to this device's storage a moment after the last change. */
function saveLinks() {
    clearTimeout(linksTimer);
    linksTimer = setTimeout(() => {
        try {
            localStorage.setItem(LINKS_KEY, JSON.stringify(localLinks));
        } catch {
            // Read again next time
        }
    }, 500);
}

// Characters whose notes changed while every chat is being read (the read may be older for them)
let touchedWhileScanning = null;

// persona id → character avatars whose chats are held to it (worked out again after a change)
let linkedByPersona = null;
const linksChanged = () => (linkedByPersona = null);

function charactersHeldTo(personaId) {
    if (!linkedByPersona) {
        linkedByPersona = new Map();
        for (const [avatar, chats] of Object.entries(chatLinks())) {
            for (const persona of Object.values(chats ?? {})) {
                const avatars = linkedByPersona.get(persona) ?? new Set();
                avatars.add(avatar);
                linkedByPersona.set(persona, avatars);
            }
        }
    }
    return [...(linkedByPersona.get(personaId) ?? [])];
}

/** One chat's lock noted (none: taken off). True: something changed. */
function noteChat(avatar, file, persona) {
    const links = chatLinks();
    const chat = stripJsonl(file);
    if (!avatar || !chat || (links[avatar]?.[chat] ?? null) === (persona || null)) {
        return false;
    }
    touchedWhileScanning?.add(avatar);
    if (persona) {
        (links[avatar] ??= {})[chat] = persona;
    } else {
        delete links[avatar][chat];
        Object.keys(links[avatar]).length || delete links[avatar];
    }
    linksChanged();
    return true;
}

/** The open chat's lock, as it is now (it may have just been set or taken off). True: it changed. */
function noteOpenChat() {
    const context = SillyTavern.getContext();
    const avatar = context.groupId ? null : context.characters?.[context.characterId]?.avatar;
    const file = context.getCurrentChatId?.();
    if (avatar && file && noteChat(avatar, file, context.chatMetadata?.persona ?? null)) {
        saveLinks();
        return true;
    }
    return false;
}

/** A chat renamed (`to`) or gone: its note follows. */
function moveNote(avatar, from, to) {
    const persona = chatLinks()[avatar]?.[stripJsonl(from)];
    if (!persona) {
        return;
    }
    noteChat(avatar, from, null);
    to && noteChat(avatar, to, persona);
    saveLinks();
}

let scanning = null;
// A read that didn't finish is tried again only after a while (not on every redraw of the list)
const RETRY_MS = 10 * 60 * 1000;
let scanTriedAt = 0;

/**
 * Every character's chats read for their locks (in the background, two characters at a time),
 * once a week at most. A character whose list couldn't be read keeps what was known of it.
 */
function scanChatLinks() {
    chatLinks();
    if (scanning || Date.now() - (Number(localLinks.at) || 0) < RESCAN_MS || Date.now() - scanTriedAt < RETRY_MS) {
        return scanning;
    }
    scanTriedAt = Date.now();
    touchedWhileScanning = new Set();
    scanning = (async () => {
        const context = SillyTavern.getContext();
        const avatars = [...new Set((context.characters ?? []).map(character => character?.avatar).filter(Boolean))];
        if (!avatars.length) {
            return;
        }
        const found = {};
        const failed = new Set();
        let next = 0;
        const worker = async () => {
            while (next < avatars.length) {
                const avatar = avatars[next++];
                try {
                    const response = await fetch('/api/characters/chats', {
                        method: 'POST',
                        headers: context.getRequestHeaders(),
                        body: JSON.stringify({ avatar_url: avatar, metadata: true }),
                    });
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const data = await response.json();
                    // (No chats: ST answers { error })
                    const chats = data?.error ? [] : (Array.isArray(data) ? data : Object.values(data ?? {}));
                    for (const chat of chats) {
                        const persona = chat?.chat_metadata?.persona;
                        typeof persona === 'string' && persona && ((found[avatar] ??= {})[stripJsonl(chat.file_name)] = persona);
                    }
                } catch {
                    failed.add(avatar);
                }
            }
        };
        await Promise.all(Array.from({ length: SCAN_AT_ONCE }, worker));
        // Most of them unreadable (the server busy or away): what was known stays, tried again later
        if (failed.size > avatars.length / 2) {
            return;
        }
        const before = chatLinks();
        for (const avatar of failed) {
            before[avatar] && (found[avatar] = before[avatar]);
        }
        // Notes made while reading are newer than what was read
        for (const avatar of touchedWhileScanning) {
            before[avatar] ? (found[avatar] = before[avatar]) : delete found[avatar];
        }
        localLinks = { at: Date.now(), links: found };
        linksChanged();
        // The open chat as it is now (its lock may be newer than its file)
        noteOpenChat();
        saveLinks();
        drawBar();
        decorate();
        shownFolder === HERE && redrawList();
    })().catch(error => console.error(`[${MODULE}] Persona chat links failed`, error)).finally(() => {
        scanning = null;
        touchedWhileScanning = null;
    });
    return scanning;
}

/**
 * The characters (and groups) a persona is connected to: [{ name, avatar | null, chat }]; ST's
 * connections first, then the characters with chats held to it (chat: true).
 */
function connectionsOf(avatarId) {
    const context = SillyTavern.getContext();
    const own = (power?.persona_descriptions?.[avatarId]?.connections ?? []).map((connection) => {
        if (connection.type === 'group') {
            const group = context.groups?.find(item => item.id === connection.id);
            return group ? { name: group.name, avatar: null, chat: false } : null;
        }
        const character = context.characters?.find(item => item.avatar === connection.id);
        return character ? { name: character.name, avatar: character.avatar, chat: false } : null;
    }).filter(Boolean);
    const shown = new Set(own.map(entry => entry.avatar).filter(Boolean));
    const held = charactersHeldTo(avatarId)
        .filter(avatar => !shown.has(avatar))
        .map(avatar => context.characters?.find(item => item.avatar === avatar))
        .filter(Boolean)
        .map(character => ({ name: character.name, avatar: character.avatar, chat: true }));
    return [...own, ...held];
}

// Rows are touched only when what they show changed, so drawing doesn't set the watcher off again
function decorate() {
    const list = document.querySelector(LIST);
    if (!list || !power) {
        return;
    }
    const on = isOn('personaTools');
    const context = SillyTavern.getContext();
    for (const row of list.querySelectorAll(':scope > .avatar-container[data-avatar-id]')) {
        const id = row.dataset.avatarId;
        const memo = on ? String(memos()[id] ?? '').trim() : '';
        const description = row.querySelector('.ch_description');
        if (description) {
            if (memo) {
                // As tall as ST makes its own text (three lines at least), so rows stay even
                const text = memo.split('\n').length < 3 ? `${memo}\n\xa0\n\xa0` : memo;
                if (description.textContent !== text) {
                    description.textContent = text;
                }
                description.classList.add('stqa_persona_memo');
            } else if (description.classList.contains('stqa_persona_memo')) {
                // The memo went: ST's own text again (as it writes it)
                const own = power.persona_descriptions?.[id]?.description;
                description.textContent = own || list.getAttribute('no_desc_text') || '';
                description.classList.remove('stqa_persona_memo');
            }
        }
        const connected = on ? connectionsOf(id) : [];
        const signature = connected.map(entry => `${entry.chat ? 'c:' : ''}${entry.avatar ?? `g:${entry.name}`}`).join('|');
        const block = row.querySelector('.character_name_block');
        const old = block?.querySelector('.stqa_persona_links');
        if (!block || (old?.dataset.signature ?? '') === signature) {
            continue;
        }
        old?.remove();
        if (!connected.length) {
            continue;
        }
        const links = document.createElement('span');
        links.className = 'stqa_persona_links';
        links.dataset.signature = signature;
        for (const entry of connected.slice(0, MAX_AVATARS)) {
            if (entry.avatar) {
                const image = document.createElement('img');
                image.className = 'stqa_persona_link';
                image.loading = 'lazy';
                image.alt = '';
                image.title = entry.chat ? `${entry.name} (채팅)` : entry.name;
                image.src = context.getThumbnailUrl('avatar', entry.avatar);
                links.append(image);
            } else {
                const group = document.createElement('i');
                group.className = 'stqa_persona_link fa-solid fa-users';
                group.title = entry.name;
                links.append(group);
            }
        }
        if (connected.length > MAX_AVATARS) {
            const more = document.createElement('small');
            more.className = 'stqa_persona_more';
            more.textContent = `+${connected.length - MAX_AVATARS}`;
            links.append(more);
        }
        block.querySelector('.ch_name')?.after(links);
    }
    syncMemoBox();
}

/** The memo box by the persona's name shows the memo of the persona in use. */
function syncMemoBox() {
    const box = document.getElementById(MEMO_ID);
    if (!box) {
        return;
    }
    box.hidden = !isOn('personaTools');
    const id = personas?.user_avatar ?? '';
    if (box.dataset.persona !== id || document.activeElement !== box) {
        box.dataset.persona = id;
        const memo = memos()[id] ?? '';
        box.value !== memo && (box.value = memo);
    }
}

function addMemoBox() {
    const controls = document.getElementById('persona_controls');
    if (!controls || document.getElementById(MEMO_ID)) {
        return;
    }
    const box = document.createElement('input');
    box.id = MEMO_ID;
    box.type = 'text';
    box.className = 'text_pole';
    box.placeholder = '메모 (목록에 설명 대신 보임)';
    box.maxLength = 200;
    box.addEventListener('input', () => {
        const id = personas?.user_avatar;
        if (!id) {
            return;
        }
        box.dataset.persona = id;
        box.value.trim() ? (memos()[id] = box.value) : delete memos()[id];
        save();
        decorate();
    });
    controls.after(box);
}

const folderOf = id => folders().find(folder => folder.keys.includes(id)) ?? null;

/** The character (or group) of the open chat: { type, id, name }, or null. */
function chatOwner() {
    const context = SillyTavern.getContext();
    if (context.groupId) {
        const group = context.groups?.find(item => item.id === context.groupId);
        return group ? { type: 'group', id: group.id, name: group.name } : null;
    }
    const character = context.characters?.[context.characterId];
    return character?.avatar ? { type: 'character', id: character.avatar, name: character.name } : null;
}

/** The personas connected to the open chat's character (or group). */
function connectedHere() {
    const owner = chatOwner();
    if (!owner) {
        return [];
    }
    // ST's connections, the character's chats held to a persona, and the open chat's own lock
    const context = SillyTavern.getContext();
    const held = new Set(owner.type === 'character' ? Object.values(chatLinks()[owner.id] ?? {}) : []);
    context.chatMetadata?.persona && held.add(context.chatMetadata.persona);
    return Object.keys(power?.personas ?? {}).filter(id => held.has(id) || (power.persona_descriptions?.[id]?.connections ?? [])
        .some(connection => connection.type === owner.type && connection.id === owner.id));
}

/** The chips over the list: every persona, each folder, the ones in none, and the folder editor. */
function drawBar() {
    const list = document.querySelector(LIST);
    if (!list) {
        return;
    }
    let bar = document.getElementById(BAR_ID);
    if (!isOn('personaTools')) {
        bar?.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.className = 'stqa_persona_folders';
        list.before(bar);
    }
    // While the list is on show: the open chat's lock noted, every chat read now and then
    if (list.offsetParent !== null) {
        noteOpenChat();
        scanChatLinks();
    }
    const all = Object.keys(power?.personas ?? {});
    const owner = chatOwner();
    const here = connectedHere();
    // A folder taken away while on show, or a chat with no connected persona: back to every persona
    const gone = shownFolder === HERE ? !here.length : shownFolder && shownFolder !== LOOSE && !folders().some(folder => folder.id === shownFolder);
    if (gone) {
        shownFolder = null;
        redrawList();
    }
    // Drawn again only when something on it changed (the list's redraws ask often)
    const signature = JSON.stringify([shownFolder, all.length, owner?.name, here.join('|'), folders().map(folder => [folder.id, folder.name, folder.keys.length])]);
    if (bar.dataset.signature === signature) {
        return;
    }
    bar.dataset.signature = signature;
    const chip = (label, count, value, icon = '') => {
        const element = document.createElement('span');
        element.className = `stqa_variant_chip${shownFolder === value ? ' stqa_active' : ''}`;
        element.innerHTML = `${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}<span></span><small></small>`;
        element.querySelector('span').textContent = label;
        element.querySelector('small').textContent = ` ${count}`;
        element.addEventListener('click', () => {
            shownFolder = value;
            drawBar();
            redrawList();
        });
        return element;
    };
    const inFolders = new Set(folders().flatMap(folder => folder.keys));
    const chips = [chip('전체', all.length, null)];
    // The open chat's character, while some persona is connected to it
    here.length && chips.push(chip(owner.name, here.length, HERE, 'fa-link'));
    for (const folder of folders()) {
        chips.push(chip(folder.name, folder.keys.filter(id => all.includes(id)).length, folder.id));
    }
    folders().length && chips.push(chip('폴더 없음', all.filter(id => !inFolders.has(id)).length, LOOSE));
    const edit = document.createElement('span');
    edit.className = 'stqa_variant_chip stqa_variant_add';
    edit.innerHTML = `<i class="fa-solid fa-folder-plus"></i>${folders().length ? '' : ' 폴더'}`;
    edit.title = '폴더 만들기·고치기';
    edit.addEventListener('click', () => openFolders().catch(error => console.error(`[${MODULE}] Persona folders failed`, error)));
    bar.replaceChildren(...chips, edit);
}

/** A yes / no question with its own button names. */
function ask(title, text, okButton) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.innerHTML = '<h3></h3><div></div>';
    content.querySelector('h3').textContent = title;
    content.querySelector('div').textContent = text;
    return new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton: '취소' }).show();
}

/** Picks which personas are in a folder (one taken from another folder moves here). */
async function pickMembers(folder) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const context = SillyTavern.getContext();
    const root = document.createElement('div');
    root.className = 'stqa_persona_pick';
    root.innerHTML = '<h3></h3><div class="stqa_panel_search"><i class="fa-solid fa-magnifying-glass"></i><input class="text_pole" type="search" placeholder="찾기"></div><div class="stqa_persona_pick_list"></div>';
    root.querySelector('h3').textContent = folder.name;
    const list = root.querySelector('.stqa_persona_pick_list');
    const picked = new Set(folder.keys);
    // The folder's own personas first, then the rest, each by name
    const byName = (a, b) => Number(picked.has(b[0])) - Number(picked.has(a[0])) || String(a[1]).localeCompare(String(b[1]));
    const rows = Object.entries(power?.personas ?? {}).sort(byName).map(([id, name]) => {
        const row = document.createElement('label');
        row.className = 'stqa_persona_pick_row';
        row.innerHTML = '<input type="checkbox"><img alt="" loading="lazy"><span class="stqa_persona_pick_text"><b></b><small></small></span>';
        row.querySelector('input').checked = picked.has(id);
        row.querySelector('img').src = context.getThumbnailUrl('persona', id);
        row.querySelector('b').textContent = name || '[이름 없음]';
        // What tells it apart: its memo, its title, or the folder it is in now
        const other = folderOf(id);
        row.querySelector('small').textContent = [memos()[id], power.persona_descriptions?.[id]?.title, other && other !== folder ? `📁 ${other.name}` : ''].filter(Boolean).join(' · ');
        row.querySelector('input').addEventListener('change', event => (event.target.checked ? picked.add(id) : picked.delete(id)));
        row.dataset.search = `${name} ${memos()[id] ?? ''} ${power.persona_descriptions?.[id]?.title ?? ''}`.toLowerCase();
        return row;
    });
    list.append(...rows);
    root.querySelector('input[type="search"]').addEventListener('input', (event) => {
        const term = event.target.value.trim().toLowerCase();
        rows.forEach(row => (row.hidden = Boolean(term) && !row.dataset.search.includes(term)));
    });
    const result = await new Popup(root, POPUP_TYPE.CONFIRM, '', { okButton: '저장', cancelButton: '취소' }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }
    for (const other of folders()) {
        other.keys = other === folder ? [...picked] : other.keys.filter(id => !picked.has(id));
    }
    save();
}

/** The folders: make one, name it again, pick its personas, take it away. */
async function openFolders() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const root = document.createElement('div');
    root.className = 'stqa_persona_folder_edit';
    let popup = null;
    const render = () => {
        root.innerHTML = '<h3>페르소나 폴더</h3><div class="stqa_persona_folder_list"></div><div class="menu_button menu_button_icon stqa_panel_button"><i class="fa-solid fa-folder-plus"></i><span>새 폴더</span></div>';
        const list = root.querySelector('.stqa_persona_folder_list');
        for (const folder of folders()) {
            const row = document.createElement('div');
            row.className = 'stqa_persona_folder_row';
            row.innerHTML = '<span class="stqa_persona_folder_name"></span><small></small><div class="menu_button fa-solid fa-plus" title="페르소나 넣기·빼기"></div><div class="menu_button fa-solid fa-pen" title="이름 바꾸기"></div><div class="menu_button fa-solid fa-trash caution" title="폴더 삭제"></div>';
            row.querySelector('.stqa_persona_folder_name').textContent = folder.name;
            row.querySelector('small').textContent = `${folder.keys.length}`;
            const [members, rename, remove] = row.querySelectorAll('.menu_button');
            members.addEventListener('click', async () => {
                await pickMembers(folder);
                render();
            });
            rename.addEventListener('click', async () => {
                const name = String(await SillyTavern.getContext().Popup.show.input('이름 바꾸기', '', folder.name) || '').trim();
                if (name) {
                    folder.name = name;
                    save();
                    render();
                }
            });
            remove.addEventListener('click', async () => {
                // Only the folder goes: its personas stay
                if (await ask('폴더 삭제', `'${folder.name}' 폴더만 지웁니다. 페르소나는 그대로 있습니다.`, '삭제')) {
                    getSettings().personaFolders = folders().filter(other => other !== folder);
                    save();
                    render();
                }
            });
            list.append(row);
        }
        root.querySelector('.stqa_panel_button').addEventListener('click', async () => {
            const name = String(await SillyTavern.getContext().Popup.show.input('새 폴더', '', '') || '').trim();
            if (!name) {
                return;
            }
            const folder = { id: newId(), name, keys: [] };
            folders().push(folder);
            save();
            await pickMembers(folder);
            render();
        });
    };
    render();
    popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '닫기' });
    await popup.show();
    drawBar();
    redrawList();
}

/**
 * ST filters the list with its search; the folder on show narrows it further, and the search
 * also finds personas by their memo (ST looks at names, titles and descriptions).
 */
function hookFilter() {
    const filter = personas?.personasFilter;
    if (!filter || filter.stqaHooked) {
        return;
    }
    const original = filter.applyFilters.bind(filter);
    filter.stqaHooked = true;
    filter.applyFilters = (data, options) => {
        let result = original(data, options);
        if (!isOn('personaTools') || !Array.isArray(result) || !Array.isArray(data)) {
            return result;
        }
        const term = String(document.getElementById('persona_search_bar')?.value ?? '').trim().toLowerCase();
        if (term) {
            const found = new Set(result);
            result = [...result, ...data.filter(id => !found.has(id) && String(memos()[id] ?? '').toLowerCase().includes(term))];
        }
        if (shownFolder === HERE) {
            const here = new Set(connectedHere());
            result = result.filter(id => here.has(id));
        } else if (shownFolder === LOOSE) {
            const inFolders = new Set(folders().flatMap(folder => folder.keys));
            result = result.filter(id => !inFolders.has(id));
        } else if (shownFolder) {
            const keys = new Set(folders().find(folder => folder.id === shownFolder)?.keys ?? []);
            result = result.filter(id => keys.has(id));
        }
        return result;
    };
}

export function applyPersonaTools() {
    if (!personas) {
        return;
    }
    // Switched off with a folder on show: the whole list again
    if (!isOn('personaTools') && shownFolder) {
        shownFolder = null;
        redrawList();
    }
    drawBar();
    decorate();
}

export function initPersonaTools() {
    const list = document.querySelector(LIST);
    if (!personas || !power || !list) {
        return;
    }
    hookFilter();
    addMemoBox();
    // ST draws the rows anew on every page, search and selection
    let scheduled = false;
    new MutationObserver(() => {
        if (scheduled) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            // (Connections may have changed: the open chat's chip counts them)
            drawBar();
            decorate();
        });
    }).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, applyPersonaTools);
    // The persona in use changes with the chat (connections, locks)
    // and the chip of the open chat's character with it
    eventSource.on(eventTypes.CHAT_CHANGED, () => setTimeout(() => {
        noteOpenChat();
        syncMemoBox();
        drawBar();
        shownFolder === HERE && redrawList();
    }, 300));
    // Notes of chats follow them (renamed, deleted with their character)
    eventTypes.CHAT_RENAMED && eventSource.on(eventTypes.CHAT_RENAMED, ({ avatarId, groupId, oldFileName, newFileName } = {}) => {
        !groupId && avatarId && moveNote(avatarId, oldFileName, newFileName);
    });
    eventSource.on(eventTypes.CHAT_DELETED, (name) => {
        // (Deleted from the chat list window: maybe another character's chat of the same name)
        if (ownChatDelete()) {
            return;
        }
        const context = SillyTavern.getContext();
        const avatar = context.groupId ? null : context.characters?.[context.characterId]?.avatar;
        avatar && moveNote(avatar, name, null);
    });
    eventSource.on(eventTypes.CHARACTER_DELETED, (data) => {
        const avatar = data?.character?.avatar;
        if (avatar && chatLinks()[avatar]) {
            delete chatLinks()[avatar];
            linksChanged();
            saveLinks();
        }
    });
    applyPersonaTools();
}
