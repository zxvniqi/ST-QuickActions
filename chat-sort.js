// Sorting a character's chat list: by the latest message (ST's own order), or by when each chat
// was made, newest or oldest first. Used by ST's chat list window (Chat History) and by this
// extension's chat list. The choice is shared by both.
import { MODULE, getSettings, isOn } from './settings.js';

const LIST_ID = 'select_chat_div';
const SEARCH_ID = 'select_chat_search';

export const CHAT_SORTS = Object.freeze([
    { value: 'recent', label: '최근 대화순' },
    { value: 'newest', label: '최신순' },
    { value: 'oldest', label: '오래된 순' },
]);

// The time ST writes in chat names and headers: 2026-11-08@14h08m51s683ms (older ones: 2023-5-1 @12h 3m 4s)
const ST_TIME = /(\d{4})-(\d{1,2})-(\d{1,2})\s?@(\d{1,2})h\s?(\d{1,2})m\s?(\d{1,2})s(?:\s?(\d+)ms)?/;

/** `loose`: also ST's other message time formats (never for chat names: a name "12" is no time). */
function parseStTime(text, loose = false) {
    const match = String(text ?? '').match(ST_TIME);
    if (!match) {
        // "October 27, 2025 11:02pm", ISO, numbers
        const time = loose && text ? SillyTavern.getContext().timestampToMoment(text)?.valueOf() : NaN;
        return Number.isFinite(time) ? time : NaN;
    }
    const [, year, month, day, hour, minute, second, ms] = match.map(Number);
    return new Date(year, month - 1, day, hour, minute, second, ms || 0).getTime();
}

// When chats without a date in their name were made: avatar + chat name → time (null: not
// known). Reading it means downloading the whole chat, so it is done once and kept on this device.
const STORE_KEY = 'stqa_chat_made_at';
// Chats read at the same time, not to flood the server with whole chats at once
const READS_AT_ONCE = 3;
let madeAt = null;

function store() {
    if (!madeAt) {
        try {
            madeAt = JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
        } catch {
            madeAt = {};
        }
    }
    return madeAt;
}

function keep() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(madeAt));
    } catch {
        // Not kept (private window, storage full): read again next time
    }
}

async function readMadeTime(character, name) {
    try {
        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ ch_name: character.name, file_name: name, avatar_url: character.avatar }),
        });
        if (!response.ok) {
            return undefined;
        }
        const lines = await response.json();
        const time = parseStTime(lines?.[0]?.create_date ?? lines?.[1]?.send_date, true);
        return Number.isFinite(time) ? time : null;
    } catch (error) {
        console.warn(`[${MODULE}] Could not read when a chat was made`, error);
        return undefined;
    }
}

/** When each chat was made (NaN: not known): from its name, else from what was read before, else read now. */
async function madeTimes(character, names) {
    const known = store();
    const keyOf = name => `${character.avatar}\u0001${name}`;
    const missing = names.filter(name => !Number.isFinite(parseStTime(name)) && !Object.hasOwn(known, keyOf(name)));
    for (let i = 0; i < missing.length; i += READS_AT_ONCE) {
        const batch = missing.slice(i, i + READS_AT_ONCE);
        const times = await Promise.all(batch.map(name => readMadeTime(character, name)));
        // A failed read (undefined) is tried again another time
        batch.forEach((name, index) => times[index] !== undefined && (known[keyOf(name)] = times[index]));
    }
    missing.length && keep();
    return names.map((name) => {
        const fromName = parseStTime(name);
        return Number.isFinite(fromName) ? fromName : (known[keyOf(name)] ?? NaN);
    });
}

/** The order chosen ('recent' while the feature is off). */
export function chatSortMode() {
    const mode = getSettings().chatSortMode;
    return isOn('chatSort') && CHAT_SORTS.some(sort => sort.value === mode) ? mode : 'recent';
}

/**
 * The chats in the chosen order. `nameOf` gives a chat's file name (without .jsonl). The latest
 * message order is the order given. Chats whose date can't be told stay last, as they came.
 */
export async function sortChats(chats, character, nameOf) {
    const mode = chatSortMode();
    if (mode === 'recent' || !character || chats.length < 2) {
        return chats;
    }
    const times = await madeTimes(character, chats.map(nameOf));
    const sign = mode === 'newest' ? -1 : 1;
    return chats
        .map((chat, index) => ({ chat, index, time: times[index] }))
        .sort((a, b) => {
            const known = Number.isFinite(b.time) - Number.isFinite(a.time);
            return known || (Number.isFinite(a.time) ? sign * (a.time - b.time) : 0) || a.index - b.index;
        })
        .map(({ chat }) => chat);
}

/** A sort button: an icon over the device's own option list. `onChange` runs after the choice is saved. */
export function createSortButton(onChange) {
    const button = document.createElement('label');
    button.className = 'stqa_chat_sort menu_button menu_button_icon fa-solid fa-arrow-down-wide-short';
    const select = document.createElement('select');
    select.append(...CHAT_SORTS.map(sort => new Option(sort.label, sort.value)));
    button.append(select);
    const sync = () => {
        select.value = chatSortMode();
        button.title = `정렬: ${CHAT_SORTS.find(sort => sort.value === select.value).label}`;
    };
    sync();
    select.addEventListener('change', () => {
        getSettings().chatSortMode = select.value;
        SillyTavern.getContext().saveSettingsDebounced();
        sync();
        onChange();
    });
    return button;
}

// ST's chat list window: its rows put in the chosen order after ST draws them. The order ST drew
// is kept, so changing the sort only moves the rows already there (nothing is fetched again).
let observer = null;
let sortRun = 0;
let stOrder = [];

async function arrangeStList() {
    const list = document.getElementById(LIST_ID);
    const context = SillyTavern.getContext();
    const character = context.groupId ? null : context.characters[context.characterId];
    const run = ++sortRun;
    if (!list || !character) {
        return;
    }
    const rows = stOrder.filter(row => row.parentElement === list);
    const nameOf = row => String(row.querySelector('.select_chat_block').getAttribute('file_name')).replace(/\.jsonl$/, '');
    const sorted = await sortChats(rows, character, nameOf);
    // ST drew the list again meanwhile: that drawing gets its own sorting
    if (run !== sortRun || sorted.some(row => row.parentElement !== list)) {
        return;
    }
    observer?.disconnect();
    list.append(...sorted);
    observer?.observe(list, { childList: true });
}

function onStListDrawn() {
    const list = document.getElementById(LIST_ID);
    stOrder = [...list.children].filter(row => row.querySelector('.select_chat_block[file_name]'));
    if (chatSortMode() !== 'recent') {
        arrangeStList().catch(error => console.error(`[${MODULE}] Chat sort failed`, error));
    }
}

function addStButton() {
    const search = document.getElementById(SEARCH_ID);
    if (!search || search.parentElement.querySelector('.stqa_chat_sort')) {
        return;
    }
    search.after(createSortButton(() => arrangeStList().catch(error => console.error(`[${MODULE}] Chat sort failed`, error))));
}

export function applyChatSort() {
    document.body.classList.toggle('stqa_chat_sort_on', isOn('chatSort'));
    isOn('chatSort') && addStButton();
}

export function initChatSort() {
    const list = document.getElementById(LIST_ID);
    if (list) {
        // ST draws the whole list at once (it empties it, then adds every row)
        observer = new MutationObserver(onStListDrawn);
        observer.observe(list, { childList: true });
    }
    applyChatSort();
}
