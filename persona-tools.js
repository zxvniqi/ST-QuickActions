// Personas, easier to find in a long list:
//  - a memo per persona, shown in the list in place of the first lines of its description
//    (typed in a box by the persona's name; the search finds it too),
//  - the characters a persona is connected to, as small round avatars by its name,
//  - folders: chips over the list show one folder's personas (ST's own search, order and pages
//    keep working on what is shown).
// ST's list is drawn page by page, so the folder is applied where ST filters the list, and the
// memo and avatars are put on each row as ST draws it.
import { MODULE, getSettings, isOn } from './settings.js';

const TITLE = '편의성 모음';
const LIST = '#user_avatar_block';
const BAR_ID = 'stqa_persona_folders';
const MEMO_ID = 'stqa_persona_memo';
const MAX_AVATARS = 5;
// Personas in no folder
const LOOSE = 'none';

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

const redrawList = () => personas?.getUserAvatars?.(true)?.catch?.(error => console.error(`[${MODULE}] Persona list failed`, error));

/** The characters (and groups) a persona is connected to: [{ name, avatar | null }]. */
function connectionsOf(avatarId) {
    const context = SillyTavern.getContext();
    return (power?.persona_descriptions?.[avatarId]?.connections ?? []).map((connection) => {
        if (connection.type === 'group') {
            const group = context.groups?.find(item => item.id === connection.id);
            return group ? { name: group.name, avatar: null } : null;
        }
        const character = context.characters?.find(item => item.avatar === connection.id);
        return character ? { name: character.name, avatar: character.avatar } : null;
    }).filter(Boolean);
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
        const signature = connected.map(entry => entry.avatar ?? `g:${entry.name}`).join('|');
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
                image.title = entry.name;
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
    const all = Object.keys(power?.personas ?? {});
    // A folder taken away while on show: back to every persona
    if (shownFolder && shownFolder !== LOOSE && !folders().some(folder => folder.id === shownFolder)) {
        shownFolder = null;
    }
    const chip = (label, count, value) => {
        const element = document.createElement('span');
        element.className = `stqa_variant_chip${shownFolder === value ? ' stqa_active' : ''}`;
        element.innerHTML = '<span></span><small></small>';
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
            row.innerHTML = '<span class="stqa_persona_folder_name"></span><small></small><div class="menu_button fa-solid fa-user-check" title="페르소나 고르기"></div><div class="menu_button fa-solid fa-pen" title="이름 바꾸기"></div><div class="menu_button fa-solid fa-trash caution" title="폴더 삭제"></div>';
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
        if (shownFolder === LOOSE) {
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
            decorate();
        });
    }).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, applyPersonaTools);
    // The persona in use changes with the chat (connections, locks)
    eventSource.on(eventTypes.CHAT_CHANGED, () => setTimeout(syncMemoBox, 300));
    applyPersonaTools();
}
