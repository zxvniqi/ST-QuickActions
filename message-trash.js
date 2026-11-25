// 휴지통: messages deleted from a chat, whichever way (ST's delete, range delete, /cut, the last
// message...), and swipes deleted one by one, are kept for a while and can be put back where they
// were. Kept on the server (user files), one file per chat, so every device sees the same trash;
// the settings hold only an index of those files.
import { MODULE, getSettings, isOn } from './settings.js';
import { isGenerating } from './util.js';

const OPTION_ID = 'stqa_option_trash';
const TITLE = '편의성 모음';
const FILE_PREFIX = 'stqa-trash-';
const DAY = 24 * 60 * 60 * 1000;

// The chat's messages as they were before the latest deletion, to tell which ones went, and each
// message's swipes (a deleted swipe is gone from the message itself)
let shadow = [];
let shadowKey = null;
let swipeShadow = new Map();
// 별지 (Sideleaf) keeps messages put away in the chat's own data, with a new revision on every
// change it makes: messages gone with that revision changed went to 별지, not to the trash
const SIDELEAF_KEY = 'sideleaf_v1';
const sideleafRevision = () => String(SillyTavern.getContext().chatMetadata?.[SIDELEAF_KEY]?.revision ?? '');
let shadowSideleaf = '';
let wasOn = false;
// Deletions our own code makes on the way to something else (not the user's)
let paused = 0;
// Trash files are read and written one change at a time
let writing = Promise.resolve();

const queued = task => (writing = writing.then(task, task));
const keepDays = () => Math.min(30, Math.max(1, Math.round(Number(getSettings().trashDays)) || 7));
// Most items one chat's trash keeps (0: no limit)
const keepCount = () => Math.max(0, Math.round(Number(getSettings().trashMax)) || 0);
const save = () => {
    SillyTavern.getContext().saveSettingsDebounced();
    showCount();
};

/** How many deletions the open chat's trash holds, on its Options menu item (none: nothing shown). */
function showCount() {
    const item = document.getElementById(OPTION_ID);
    if (!item) {
        return;
    }
    const key = isOn('messageTrash') ? openChat()?.key : null;
    const count = key ? Number(getSettings().trashIndex?.[key]?.count) || 0 : 0;
    count ? (item.dataset.stqaCount = count > 99 ? '99+' : String(count)) : delete item.dataset.stqaCount;
}
const stripExtension = name => String(name ?? '').replace(/\.jsonl$/, '');
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** The open chat: who it belongs to and its file name. */
function openChat() {
    const context = SillyTavern.getContext();
    const chat = context.getCurrentChatId();
    if (!chat) {
        return null;
    }
    if (context.groupId) {
        return { key: `g:${context.groupId}:${chat}`, kind: 'g', owner: context.groupId, chat };
    }
    const avatar = context.characters[context.characterId]?.avatar;
    return avatar ? { key: `c:${avatar}:${chat}`, kind: 'c', owner: avatar, chat } : null;
}

function hash(text) {
    let value = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
    }
    return (value >>> 0).toString(16);
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

/** A message told apart from the others, to find the one a deleted message came after. */
const fingerprint = message => `${message.send_date}\u0001${message.name}\u0001${String(message.mes ?? '').slice(0, 80)}`;

/** The message matching a fingerprint nearest to where it was (two may look the same); -1 if none. */
function findNear(chat, print, near) {
    let best = -1;
    chat.forEach((message, index) => {
        if (fingerprint(message) === print && (best === -1 || Math.abs(index - near) < Math.abs(best - near))) {
            best = index;
        }
    });
    return best;
}

/** Every time a message was sent at (its own and each of its swipes'): swiping changes its own. */
const datesOf = message => [message?.send_date, ...(Array.isArray(message?.swipe_info) ? message.swipe_info.map(info => info?.send_date) : [])].filter(Boolean);

/**
 * The message a fingerprint names, nearest to `near`; when its text has changed since (edited,
 * swiped), by its name and one of its send times. -1 if none.
 */
function findAnchor(chat, print, near) {
    const exact = findNear(chat, print, near);
    if (exact !== -1) {
        return exact;
    }
    const [date, name] = String(print ?? '').split('\u0001');
    let best = -1;
    chat.forEach((message, index) => {
        if (date && message.name === name && datesOf(message).includes(date) && (best === -1 || Math.abs(index - near) < Math.abs(best - near))) {
            best = index;
        }
    });
    return best;
}

/**
 * The message deleted swipes came from, if it is still there: the same speaker, still holding the
 * reply it showed after the deletion (or one sent at the same time). Nearest to where it was; -1 if none.
 */
// How much of each remaining swipe identifies the message a deleted swipe came from
const OWNER_PREFIX = 200;

function swipeOwner(chat, item) {
    const shown = item.template ?? {};
    const own = new Set(Array.isArray(shown.stqaOwnSwipes) ? shown.stqaOwnSwipes : []);
    const textsOf = message => (Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes]);
    const isOwner = message => Boolean(message.is_user) === Boolean(shown.is_user) && message.name === item.name
        && (textsOf(message).some(text => own.has(String(text ?? '').slice(0, OWNER_PREFIX)))
            || textsOf(message).includes(shown.mes)
            || (Boolean(shown.send_date) && datesOf(message).includes(shown.send_date)));
    let best = -1;
    chat.forEach((message, index) => {
        if (isOwner(message) && (best === -1 || Math.abs(index - item.index) < Math.abs(best - item.index))) {
            best = index;
        }
    });
    return best;
}

/**
 * A chat's trash file, named after the chat alone: the index of trash files is in the settings,
 * which another device may save over, and a chat's file is found again without it.
 */
const fileFor = key => `${FILE_PREFIX}${hash(key)}${hash([...key].reverse().join(''))}.json`;

/** Whose chat a key names ("c:avatar:chat" / "g:group:chat"). */
function chatOfKey(key) {
    const rest = key.slice(2);
    const cut = rest.indexOf(':');
    return { kind: key[0], owner: rest.slice(0, cut), chat: rest.slice(cut + 1) };
}

/** Every file a chat's trash may be in: the one the index names (older ones were named by time) and its own. */
const filesOf = key => [...new Set([getSettings().trashIndex?.[key]?.file, fileFor(key)].filter(Boolean))];

/** A trash file's items; null if it isn't there or is another chat's (a file says whose it is). */
async function readFile(file, key) {
    const response = await fetch(`/user/files/${file}`, { cache: 'no-store' });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`Trash not read (${response.status})`);
    }
    const data = await response.json();
    if (!Array.isArray(data?.items)) {
        throw new Error('Trash file not readable');
    }
    // (Files from before don't say: taken as this chat's)
    return data.key === undefined || data.key === key ? data.items : null;
}

/**
 * A chat's trash (from all its files, each item once). Only a trash that isn't there reads as
 * empty: one that couldn't be read (network, server) throws, so nothing is written over it with
 * what little is known.
 */
async function readTrash(key) {
    const items = [];
    const seen = new Set();
    for (const file of filesOf(key)) {
        for (const item of await readFile(file, key) ?? []) {
            seen.has(item.id) || (seen.add(item.id), items.push(item));
        }
    }
    return items;
}

/** True: the file is gone (or never was). */
async function deleteFile(file) {
    try {
        const response = await fetch('/api/files/delete', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ path: `user/files/${file}` }),
        });
        return response.ok || response.status === 404;
    } catch {
        return false;
    }
}

async function uploadTrash(file, items, key) {
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ name: file, data: toBase64(JSON.stringify({ key, items })) }),
    });
    if (!response.ok) {
        throw new Error(`Trash not saved (${response.status})`);
    }
}

/**
 * Writes a chat's trash into its own file (an empty one takes its files away); a file named the
 * older way goes once its items are in the new one.
 */
async function writeTrash(key, items, chat = null) {
    const settings = getSettings();
    settings.trashIndex ??= {};
    const old = filesOf(key);
    if (!items.length) {
        for (const file of old) {
            if (!await deleteFile(file)) {
                throw new Error('Trash not emptied');
            }
        }
        if (settings.trashIndex[key]) {
            delete settings.trashIndex[key];
            save();
        }
        return;
    }
    const { kind, owner, chat: name } = chat ?? settings.trashIndex[key] ?? chatOfKey(key);
    const entry = { file: fileFor(key), kind, owner, chat: name };
    await uploadTrash(entry.file, items, key);
    // An older file that won't go is made the same, so what was taken out doesn't come back from it
    for (const file of old.filter(file => file !== entry.file)) {
        (await deleteFile(file)) || await uploadTrash(file, items, key);
    }
    entry.oldest = Math.min(...items.map(item => item.deleted));
    entry.count = items.length;
    settings.trashIndex[key] = entry;
    save();
}

/**
 * The open chat's trash put back in the index when another device's settings lost it (its file
 * is named after the chat), so the cleanup by age finds it again.
 */
function relinkOpenChat() {
    const chat = openChat();
    if (!chat || !isOn('messageTrash') || getSettings().trashIndex?.[chat.key]) {
        return;
    }
    queued(async () => {
        if (getSettings().trashIndex?.[chat.key]) {
            return;
        }
        const items = await readFile(fileFor(chat.key), chat.key);
        if (items?.length) {
            const settings = getSettings();
            settings.trashIndex ??= {};
            settings.trashIndex[chat.key] = { file: fileFor(chat.key), kind: chat.kind, owner: chat.owner, chat: chat.chat, oldest: Math.min(...items.map(item => item.deleted)), count: items.length };
            save();
        }
    }).catch(() => {
        // Tried again when the chat is opened next
    });
}

/** Over the most a trash keeps, the items deleted longest ago go (the rest keep their order). */
function capped(items) {
    const max = keepCount();
    if (!max || items.length <= max) {
        return items;
    }
    const kept = new Set([...items].sort((a, b) => b.deleted - a.deleted).slice(0, max));
    return items.filter(item => kept.has(item));
}

/** Adds to a chat's trash; a failure is told (the deletion itself stands). True once it is there. */
function addToTrash(key, chat, change) {
    return queued(async () => {
        const items = await readTrash(key);
        change(items);
        await writeTrash(key, capped(items), chat);
        return true;
    }).catch((error) => {
        console.error(`[${MODULE}] Trash failed`, error);
        toastr.error('지운 메시지를 휴지통에 옮기지 못했습니다.', TITLE);
        return false;
    });
}

// Deletions gathered when the page was left: the page may close before they reach the server, so
// they are also kept in the browser and put in the trash on the next visit (once only, by id)
const PENDING_KEY = 'stqa_trash_pending';
// The account signed in (ST with user accounts: several may use one browser)
let userHandle = () => 'default-user';
const userReady = import('../../../user.js')
    .then(user => typeof user.getCurrentUserHandle === 'function' && (userHandle = user.getCurrentUserHandle))
    .catch(() => {});

function readPending() {
    try {
        const list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function writePending(list) {
    try {
        list.length ? localStorage.setItem(PENDING_KEY, JSON.stringify(list)) : localStorage.removeItem(PENDING_KEY);
    } catch {
        // (Too big for the browser's storage: only the upload is left)
    }
}

/** Puts `item` into a chat's trash, unless it is there already. */
function addItem(key, chat, item) {
    return addToTrash(key, chat, items => items.some(other => other.id === item.id) || items.push(item))
        .then(done => done && writePending(readPending().filter(entry => entry.item?.id !== item.id)));
}

/** What a page left last time kept in the browser. */
async function sendPending() {
    await userReady;
    // (Another account's: left for it)
    for (const { key, chat, item, user } of readPending()) {
        key && item?.id && (user ?? 'default-user') === userHandle() && addItem(key, chat, item);
    }
}

// Deletions in a row (a range is deleted one message at a time) are gathered into one item
// (ST's /cut and "Delete messages" save between deletions, so it can take a moment)
const GATHER_MS = 1000;
let gathering = null;

/** A message's swipes as they are now (kept as they were while one of them is being deleted). */
function swipesOf(message, previous) {
    if (previous && message.swipes.length < previous.swipes.length) {
        return previous;
    }
    return { swipes: message.swipes.slice(), info: Array.isArray(message.swipe_info) ? message.swipe_info.slice() : [] };
}

function snapshot() {
    const chat = SillyTavern.getContext().chat;
    shadow = chat.slice();
    shadowKey = openChat()?.key ?? null;
    shadowSideleaf = sideleafRevision();
    const swipes = new Map();
    for (const message of chat) {
        if (Array.isArray(message.swipes) && message.swipes.length > 1) {
            swipes.set(message, swipesOf(message, swipeShadow.get(message)));
        }
    }
    swipeShadow = swipes;
}

// Deletions being gathered into one item: { key, chat, sideleaf, before, copies, messages }. What
// went is worked out the moment ST tells of it (the chat may be another one a moment later); the
// short wait only puts deletions in a row into one item
let batch = null;

/** What of `before` is gone from `now`: [{ index, anchor, message }] (copies kept per message). */
function goneFrom(before, now, copies) {
    const left = new Set(now);
    const gone = before.filter(message => !left.has(message));
    // Nothing of before left in a chat that has messages: it was loaded again, nothing was deleted
    if (!gone.length || (left.size && gone.length === before.length)) {
        return [];
    }
    const messages = [];
    // The nearest message before each that stays: where it goes back (one pass)
    let anchor = null;
    before.forEach((message, index) => {
        if (left.has(message)) {
            anchor = fingerprint(message);
            return;
        }
        copies.has(message) || copies.set(message, copy(message));
        messages.push({ index, anchor, message: copies.get(message) });
    });
    return messages;
}

/** The gathered deletions go to the trash now. */
function flush(leaving = false) {
    clearTimeout(gathering);
    gathering = null;
    const done = batch;
    batch = null;
    snapshot();
    // Put away in 별지 (it saved a new revision meanwhile): not deleted. (Another chat open by now:
    // what was seen when the deletion came counts)
    const sideleafNow = openChat()?.key === done?.key ? sideleafRevision() : done?.sideleafSeen;
    if (!done?.messages.length || !isOn('messageTrash') || sideleafNow !== done.sideleaf) {
        return;
    }
    const item = { id: newId(), deleted: Date.now(), messages: done.messages };
    leaving && writePending([...readPending(), { key: done.key, chat: done.chat, item, user: userHandle() }]);
    addItem(done.key, done.chat, item);
}

/** The chat changed some other way: the snapshot follows it. */
function remember() {
    // Off: nothing is kept, so nothing is copied either
    if (!isOn('messageTrash')) {
        return;
    }
    if (batch) {
        // Another chat open now: what was gathered from the last one goes to its trash at once
        openChat()?.key !== batch.key && flush();
        // (Otherwise the chat as it was before them is kept until they are taken)
        return;
    }
    // Fewer messages and no deletion heard of yet: another extension reacted to a deletion before
    // us (and reported a change); the snapshot must not take the chat without those messages
    if (openChat()?.key === shadowKey && SillyTavern.getContext().chat.length < shadow.length) {
        onDeleted();
        return;
    }
    snapshot();
}

function onDeleted() {
    if (paused || !isOn('messageTrash')) {
        return;
    }
    const chat = openChat();
    if (!chat || chat.key !== shadowKey) {
        // (The snapshot is of another chat: nothing can be told)
        batch && flush();
        snapshot();
        return;
    }
    batch ??= { key: shadowKey, chat, sideleaf: shadowSideleaf, before: shadow, copies: new Map(), messages: [] };
    batch.messages = goneFrom(batch.before, SillyTavern.getContext().chat, batch.copies);
    batch.sideleafSeen = sideleafRevision();
    clearTimeout(gathering);
    gathering = setTimeout(flush, GATHER_MS);
}

/**
 * One swipe deleted: it goes to the trash, with the other swipes deleted from the same message
 * (one item per message), and with what is needed to make the message again if it is gone by then.
 */
function onSwipeDeleted(data) {
    const context = SillyTavern.getContext();
    const message = context.chat[Number(data?.messageId)];
    const before = message && swipeShadow.get(message);
    const swipeId = Number(data?.swipeId);
    if (message && Array.isArray(message.swipes)) {
        swipeShadow.set(message, swipesOf(message));
    }
    const chat = openChat();
    // What was kept must be the message just before this one deletion (one swipe more)
    if (paused || !isOn('messageTrash') || !chat || chat.key !== shadowKey || !before || !Number.isInteger(swipeId)
        || swipeId >= before.swipes.length || before.swipes.length !== message.swipes.length + 1) {
        return;
    }
    const index = context.chat.indexOf(message);
    const anchor = index > 0 ? fingerprint(context.chat[index - 1]) : null;
    const swipe = { id: newId(), deleted: Date.now(), at: swipeId, text: before.swipes[swipeId], info: copy(before.info[swipeId]) };
    const template = copy({ ...message, swipes: undefined, swipe_info: undefined, swipe_id: undefined });
    // ST tells of the deletion before it shows another swipe: the message is known by the swipes
    // it still has (their starts), not by what it showed, which may be the very swipe deleted
    template.mes = message.swipes[Number(data?.newSwipeId)] ?? message.swipes[0] ?? template.mes;
    template.stqaOwnSwipes = message.swipes.map(text => String(text ?? '').slice(0, OWNER_PREFIX));
    addToTrash(chat.key, chat, (items) => {
        const same = items.find(item => item.kind === 'swipe' && item.index === index && item.anchor === anchor && item.name === message.name);
        if (same) {
            same.swipes.push(swipe);
        } else {
            items.push({ id: newId(), kind: 'swipe', deleted: swipe.deleted, index, anchor, name: message.name, template, swipes: [swipe] });
        }
    });
}

/** Deletions made inside `task` are not the user's: they stay out of the trash. */
export async function withoutTrash(task) {
    // The user's own deletions just before go to the trash first (they are theirs, these aren't)
    batch && flush();
    paused++;
    try {
        return await task();
    } finally {
        paused--;
        !paused && isOn('messageTrash') && !batch && snapshot();
    }
}

function restoreRuns(chat, messages) {
    const sorted = [...messages].sort((a, b) => a.index - b.index);
    // Runs of messages that were next to each other go back together, after the same message
    const runs = [];
    for (const entry of sorted) {
        const last = runs[runs.length - 1];
        last && last[0].anchor === entry.anchor ? last.push(entry) : runs.push([entry]);
    }
    for (const run of runs) {
        let at = 0;
        if (run[0].anchor !== null) {
            const found = findAnchor(chat, run[0].anchor, run[0].index - 1);
            at = found === -1 ? Math.min(run[0].index, chat.length) : found + 1;
        }
        chat.splice(at, 0, ...run.map(entry => entry.message));
    }
}

/**
 * Swipes go back to the end of the message they came from; if that message is gone, they come back
 * as a message of their own in its place.
 */
function restoreSwipes(chat, item, swipes) {
    const sorted = [...swipes].sort((a, b) => a.at - b.at);
    // Only the very message they came from takes them back (never the one that is now in its place)
    const owner = swipeOwner(chat, item);
    const candidate = owner === -1 ? null : chat[owner];
    if (candidate) {
        if (!Array.isArray(candidate.swipes) || !candidate.swipes.length) {
            candidate.swipes = [candidate.mes];
            candidate.swipe_info = [{ send_date: candidate.send_date, gen_started: candidate.gen_started, gen_finished: candidate.gen_finished, extra: copy(candidate.extra ?? {}) }];
            candidate.swipe_id = 0;
        }
        if (!Array.isArray(candidate.swipe_info)) {
            candidate.swipe_info = candidate.swipes.map(() => ({}));
        }
        // (Kept as long as the swipes, so each swipe's info stays at its own place)
        while (candidate.swipe_info.length < candidate.swipes.length) {
            candidate.swipe_info.push({});
        }
        // (A swipe that is back already, put back twice, isn't added again)
        for (const swipe of sorted.filter(entry => !candidate.swipes.includes(entry.text))) {
            candidate.swipes.push(swipe.text);
            candidate.swipe_info.push(swipe.info ?? {});
        }
        return;
    }
    const first = sorted[0].info ?? {};
    const message = {
        ...copy(item.template),
        mes: sorted[0].text,
        swipes: sorted.map(swipe => swipe.text),
        swipe_info: sorted.map(swipe => swipe.info ?? {}),
        swipe_id: 0,
    };
    delete message.stqaOwnSwipes;
    first.send_date && (message.send_date = first.send_date);
    first.extra && (message.extra = copy(first.extra));
    const found = item.anchor === null ? -1 : findAnchor(chat, item.anchor, item.index - 1);
    const at = item.anchor === null ? 0 : found === -1 ? Math.min(item.index, chat.length) : found + 1;
    chat.splice(at, 0, message);
}

/** Puts trash back into the open chat. `picks`: [{ item, entries }] (messages, or a message's swipes). */
/**
 * Puts trash back into the open chat (it must still be the chat `key` names), then reads the chat
 * back from the server. The picked entries found there are returned (by entryKey): ST's save
 * doesn't say when it failed, so only what came back saved may leave the trash.
 */
async function restore(picks, key) {
    const context = SillyTavern.getContext();
    if (openChat()?.key !== key) {
        throw new Error('Another chat is open');
    }
    const chat = context.chat;
    // How many times each swipe text is in the chat before (so one found after is the one put back)
    const textCounts = list => list.flatMap(message => (Array.isArray(message.swipes) ? message.swipes : [message.mes]))
        .reduce((counts, text) => counts.set(text, (counts.get(text) ?? 0) + 1), new Map());
    const before = textCounts(chat);
    // Whole messages (time, name, side and all of the text), counted the same way
    const whole = message => `${message.send_date}\u0001${message.name}\u0001${Boolean(message.is_user)}\u0001${message.mes}`;
    const messageCounts = list => list.reduce((counts, message) => counts.set(whole(message), (counts.get(whole(message)) ?? 0) + 1), new Map());
    const messagesBefore = messageCounts(chat);
    const latestFirst = list => [...list].sort((a, b) => b.item.deleted - a.item.deleted);
    // Messages first (swipes may belong to one of them), the latest deletion first: a message
    // deleted earlier may go back after one deleted later
    for (const { entries } of latestFirst(picks.filter(pick => pick.item.kind !== 'swipe'))) {
        restoreRuns(chat, entries);
    }
    for (const { item, entries } of latestFirst(picks.filter(pick => pick.item.kind === 'swipe'))) {
        restoreSwipes(chat, item, entries);
    }
    await context.saveChat();
    await context.reloadCurrentChat();
    const now = SillyTavern.getContext();
    const back = new Set();
    if (openChat()?.key !== key) {
        return back;
    }
    const messagesGained = messageCounts(now.chat);
    for (const [print, count] of messagesBefore) {
        messagesGained.set(print, (messagesGained.get(print) ?? 0) - count);
    }
    const takeMessage = (message) => {
        const left = messagesGained.get(whole(message)) ?? 0;
        messagesGained.set(whole(message), left - 1);
        return left > 0;
    };
    const gained = textCounts(now.chat);
    for (const [text, count] of before) {
        gained.set(text, (gained.get(text) ?? 0) - count);
    }
    const takeGained = (text) => {
        const left = gained.get(text) ?? 0;
        gained.set(text, left - 1);
        return left > 0;
    };
    for (const { item, entries } of picks) {
        for (const entry of entries) {
            const there = item.kind === 'swipe' ? takeGained(entry.text) : takeMessage(entry.message);
            there && back.add(entryKey(item, entry));
        }
    }
    return back;
}

/** An item's pickable entries: messages, or the swipes of a message. */
const entriesOf = item => (item.kind === 'swipe' ? item.swipes : item.messages);
const entryKey = (item, entry) => (item.kind === 'swipe' ? `${item.id}:s:${entry.id}` : `${item.id}:${entry.index}`);

/** Takes picked entries out of a chat's trash; items left empty go too. */
async function removePicked(key, picked) {
    const items = (await readTrash(key))
        .map((item) => {
            const left = entriesOf(item).filter(entry => !picked.has(entryKey(item, entry)));
            return item.kind === 'swipe'
                ? { ...item, swipes: left, deleted: Math.min(...left.map(swipe => swipe.deleted)) }
                : { ...item, messages: left };
        })
        .filter(item => entriesOf(item).length);
    await writeTrash(key, items);
}

/** A yes / no question with its own button names. */
function ask(title, text, okButton, cancelButton = '취소') {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.innerHTML = '<h3></h3><div></div>';
    content.querySelector('h3').textContent = title;
    content.querySelector('div').textContent = text;
    return new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton }).show();
}

function formatTime(time) {
    const date = new Date(time);
    const pad = number => String(number).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * One message (or swipe) in full: drawn the way the chat draws it, or with `raw` as its text is
 * written (the trash: regexes and HTML made for the chat come out broken out of their place).
 */
/**
 * A text in a window of its own. translation: the same text translated; a button then turns
 * between the two (starting on the translation when translated is true).
 */
export function showFullText(title, text, message = null, { translation = null, translated = false } = {}) {
    const context = SillyTavern.getContext();
    const view = document.createElement('div');
    view.className = 'stqa_trash_view';
    view.innerHTML = '<div class="stqa_trash_view_head"><h3></h3></div><div></div>';
    view.querySelector('h3').textContent = title;
    const box = view.lastElementChild;
    // The text as written, shown as text: tags a regex turns into a screen (<loc>…</loc>, status
    // panels) read as they are, instead of coming out as that screen's code
    const draw = (shown) => {
        box.className = 'stqa_raw_text';
        box.textContent = String(shown ?? '');
    };
    let onTranslation = Boolean(translation) && translated;
    if (translation) {
        const turn = document.createElement('div');
        turn.className = 'menu_button menu_button_icon stqa_trash_view_turn';
        const label = () => (turn.innerHTML = `<i class="fa-solid fa-language"></i><span>${onTranslation ? '원문 보기' : '번역문 보기'}</span>`);
        turn.addEventListener('click', () => {
            onTranslation = !onTranslation;
            label();
            draw(onTranslation ? translation : text);
        });
        label();
        view.firstElementChild.append(turn);
    }
    draw(onTranslation ? translation : text);
    new context.Popup(view, context.POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, allowVerticalScrolling: true }).show();
}

async function openTrash() {
    const chat = openChat();
    if (!chat) {
        toastr.info('열린 채팅이 없습니다.', TITLE);
        return;
    }
    // A deletion just made may still be on its way in (gathered for a moment, then written to
    // the server): taken in now, and the window waits for it
    if (batch) {
        flush();
    }
    await writing.catch(() => {});
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.className = 'stqa_trash';

    const button = (icon, text, onClick, caution = false) => {
        const element = document.createElement('div');
        element.className = `menu_button menu_button_icon${caution ? ' caution' : ''}`;
        element.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
        element.querySelector('span').textContent = text;
        element.addEventListener('click', onClick);
        return element;
    };
    // Something changed while the window was up (another chat, a reply started)
    const blocked = () => {
        if (openChat()?.key !== chat.key) {
            toastr.warning('그사이 채팅이 바뀌었습니다.', TITLE);
            return true;
        }
        if (isGenerating()) {
            toastr.info('답변을 만드는 중에는 쓸 수 없습니다.', TITLE);
            return true;
        }
        return false;
    };
    const change = async (task) => {
        if (blocked()) {
            return;
        }
        await queued(task).catch((error) => {
            console.error(`[${MODULE}] Trash failed`, error);
            toastr.error('휴지통을 바꾸지 못했습니다.', TITLE);
        });
        await render();
    };

    // A checkbox with its text (the text is set as text: messages hold anything)
    const tick = (className, text) => {
        const label = document.createElement('label');
        label.className = `checkbox_label ${className}`;
        label.innerHTML = '<input type="checkbox"><span></span>';
        label.querySelector('span').textContent = text;
        return label;
    };
    // Boxes to pick several are shown only after "여러 개 고르기"
    let picking = false;
    const restorePicks = picks => change(async () => {
        picking = false;
        const picked = new Set(picks.flatMap(({ item, entries }) => entries.map(entry => entryKey(item, entry))));
        const back = await restore(picks, chat.key);
        back.size && await removePicked(chat.key, back);
        const missing = picked.size - back.size;
        missing
            ? toastr.warning(`${back.size}개를 되살렸습니다. ${missing}개는 저장된 것을 확인하지 못해 휴지통에 남겨 두었습니다.`, TITLE)
            : toastr.success(`${picked.size}개를 되살렸습니다.`, TITLE);
    });

    const render = async () => {
        let items = null;
        try {
            items = (await readTrash(chat.key)).sort((a, b) => b.deleted - a.deleted);
        } catch (error) {
            console.error(`[${MODULE}] Trash not read`, error);
        }
        const days = keepDays();
        content.innerHTML = '<h3>휴지통</h3><div class="stqa_hint"></div><div class="stqa_trash_items"></div>';
        content.querySelector('.stqa_hint').textContent = `지운 지 ${days}일이 지나면 완전히 삭제됩니다.`;
        content.classList.toggle('stqa_trash_picking', picking);
        const list = content.querySelector('.stqa_trash_items');
        // Not read (nothing is changed then): it can still be emptied
        if (!items) {
            list.innerHTML = '<div class="stqa_hint">휴지통을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.</div>';
            const bottom = document.createElement('div');
            bottom.className = 'stqa_trash_bottom';
            bottom.append(button('fa-dumpster', '휴지통 비우기', async () => {
                if (await ask('휴지통 비우기', '이 채팅의 휴지통을 모두 지웁니다. 되돌릴 수 없습니다.', '비우기')) {
                    await change(() => writeTrash(chat.key, []));
                }
            }, true));
            content.append(bottom);
            return;
        }
        if (!items.length) {
            list.innerHTML = '<div class="stqa_hint">휴지통이 비어 있습니다.</div>';
            return;
        }
        // Ticked entries: [item, entry, checkbox]
        const ticks = [];
        const restoreTicked = button('fa-rotate-left', '', () => {
            const picks = items
                .map(item => ({ item, entries: ticks.filter(([owner, , box]) => owner === item && box.checked).map(([, entry]) => entry) }))
                .filter(pick => pick.entries.length);
            picks.length && restorePicks(picks);
        });
        // While picking, deleting the ticked ones takes the place of emptying the whole trash
        const ticked = () => new Set(ticks.filter(([, , box]) => box.checked).map(([item, entry]) => entryKey(item, entry)));
        const deleteTicked = button('fa-trash', '', async () => {
            const picked = ticked();
            if (picked.size && await ask('선택 삭제', `${picked.size}개 · 되돌릴 수 없습니다.`, '삭제')) {
                await change(async () => {
                    picking = false;
                    await removePicked(chat.key, picked);
                });
            }
        }, true);
        const emptyAll = button('fa-dumpster', '휴지통 비우기', async () => {
            if (await ask('휴지통 비우기', '이 채팅의 휴지통을 모두 지웁니다. 되돌릴 수 없습니다.', '비우기')) {
                await change(() => writeTrash(chat.key, []));
            }
        }, true);
        const count = () => {
            const size = ticked().size;
            restoreTicked.querySelector('span').textContent = `선택한 ${size}개 되살리기`;
            restoreTicked.hidden = !size;
            deleteTicked.querySelector('span').textContent = `선택한 ${size}개 삭제`;
            deleteTicked.hidden = !picking;
            deleteTicked.classList.toggle('stqa_dim', !size);
            emptyAll.hidden = picking;
        };
        for (const item of items) {
            const block = document.createElement('div');
            block.className = 'stqa_trash_item';
            const left = Math.max(0, Math.ceil((item.deleted + days * DAY - Date.now()) / DAY));
            const swipes = item.kind === 'swipe';
            const what = swipes ? `#${item.index} ${item.name ?? ''}의 스와이프 ${item.swipes.length}개` : `${item.messages.length}개`;
            const head = tick('stqa_trash_head', `${formatTime(item.deleted)} 지움 · ${what} · ${left}일 남음`);
            block.append(head);
            const own = [];
            const entries = swipes ? [...item.swipes].sort((a, b) => a.deleted - b.deleted) : [...item.messages].sort((a, b) => a.index - b.index);
            for (const entry of entries) {
                const text = swipes ? entry.text : entry.message.mes;
                const title = swipes ? `#${item.index} ${item.name ?? ''} · 스와이프` : `#${entry.index} ${entry.message.name ?? ''}`;
                const line = tick('stqa_trash_message', `${swipes ? `스와이프 ${entry.at + 1}` : title}: ${String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) || '(빈 메시지)'}`);
                const box = line.querySelector('input');
                own.push(box);
                ticks.push([item, entry, box]);
                box.addEventListener('change', () => {
                    head.querySelector('input').checked = own.every(other => other.checked);
                    count();
                });
                // Not picking: a tap shows it in full instead of ticking it
                line.addEventListener('click', (event) => {
                    if (!picking) {
                        event.preventDefault();
                        showFullText(title, text, null, { raw: true });
                    }
                });
                block.append(line);
            }
            head.addEventListener('click', event => picking || event.preventDefault());
            // One entry: its own box is enough
            head.classList.toggle('stqa_trash_single', own.length === 1);
            // The group's box ticks all of its entries
            head.querySelector('input').addEventListener('change', (event) => {
                own.forEach(box => (box.checked = event.target.checked));
                count();
            });
            const actions = document.createElement('div');
            actions.className = 'stqa_trash_actions';
            actions.append(
                button('fa-rotate-left', '되살리기', () => restorePicks([{ item, entries: entriesOf(item) }])),
                button('fa-trash', '바로 삭제', async () => {
                    if (await ask('바로 삭제', '되돌릴 수 없습니다.', '삭제')) {
                        await change(async () => writeTrash(chat.key, (await readTrash(chat.key)).filter(other => other.id !== item.id)));
                    }
                }, true),
            );
            block.append(actions);
            list.append(block);
        }
        count();
        const bottom = document.createElement('div');
        bottom.className = 'stqa_trash_bottom';
        content.append(bottom);
        const pickButton = button(picking ? 'fa-xmark' : 'fa-list-check', picking ? '고르기 취소' : '여러 개 고르기', () => {
            picking = !picking;
            content.classList.toggle('stqa_trash_picking', picking);
            pickButton.querySelector('i').className = `fa-solid ${picking ? 'fa-xmark' : 'fa-list-check'}`;
            pickButton.querySelector('span').textContent = picking ? '고르기 취소' : '여러 개 고르기';
            // Leaving picking lets go of what was ticked
            if (!picking) {
                ticks.forEach(([, , box]) => (box.checked = false));
                content.querySelectorAll('.stqa_trash_head input').forEach(box => (box.checked = false));
            }
            count();
        });
        // While picking: 되살리기 · 삭제 · 취소; otherwise: 여러 개 고르기 · 휴지통 비우기
        bottom.append(restoreTicked, deleteTicked, pickButton, emptyAll);
    };

    await render();
    // Only the list scrolls: the title and the buttons under it stay where they are
    await new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기' }).show();
}

/** Every chat's trash taken away (the feature switched off and the user said so). */
function clearAll() {
    return queued(async () => {
        const settings = getSettings();
        for (const key of Object.keys(settings.trashIndex ?? {})) {
            for (const file of filesOf(key)) {
                await deleteFile(file);
            }
        }
        settings.trashIndex = {};
        save();
    });
}

/** Trash of chats that no longer exist goes with them. */
function forget(match) {
    return queued(async () => {
        const settings = getSettings();
        for (const [key, entry] of Object.entries(settings.trashIndex ?? {})) {
            if (match(entry)) {
                for (const file of filesOf(key)) {
                    await deleteFile(file);
                }
                delete settings.trashIndex[key];
            }
        }
        save();
    });
}

// Chats being deleted by this extension's own code, which takes care of their trash itself (it
// knows whose chats they are; ST's notice of a deleted chat gives only its name)
let ownDeletes = 0;

/** Whether a chat being deleted now is this extension's doing (it says whose; ST's notice doesn't). */
export const ownChatDelete = () => ownDeletes > 0;

export async function withOwnChatDeletes(task) {
    ownDeletes++;
    try {
        return await task();
    } finally {
        ownDeletes--;
    }
}

/** The trash of one chat taken away (`kind`: 'c' character, 'g' group), also when the index lost it. */
export function forgetChat(kind, owner, name) {
    const key = `${kind}:${owner}:${stripExtension(name)}`;
    return queued(() => writeTrash(key, []));
}

/** A chat ST deleted: it was one of the open character's (or group's), never another's of the same name. */
function onChatDeleted(kind, name) {
    if (ownDeletes) {
        return;
    }
    const context = SillyTavern.getContext();
    const owner = kind === 'g' ? context.groupId : context.characters[context.characterId]?.avatar;
    owner && forgetChat(kind, owner, name).catch(error => console.error(`[${MODULE}] Trash cleanup failed`, error));
}

/** A renamed chat keeps its trash. */
function onRenamed({ avatarId, groupId, oldFileName, newFileName } = {}) {
    const kind = groupId ? 'g' : 'c';
    const owner = groupId || avatarId;
    if (!owner || !oldFileName || !newFileName) {
        return;
    }
    const oldKey = `${kind}:${owner}:${stripExtension(oldFileName)}`;
    const newKey = `${kind}:${owner}:${stripExtension(newFileName)}`;
    // Moved into the file named after the new name (written first, the old one goes after)
    queued(async () => {
        const items = await readTrash(oldKey);
        if (!items.length || oldKey === newKey) {
            return;
        }
        const existing = await readTrash(newKey);
        const known = new Set(existing.map(item => item.id));
        const moved = [...existing, ...items.filter(item => !known.has(item.id))];
        await writeTrash(newKey, moved, { kind, owner, chat: stripExtension(newFileName) });
        await writeTrash(oldKey, []);
    }).catch(error => console.error(`[${MODULE}] Trash rename failed`, error));
}

/** What of an item is still within its time (swipes run out one by one); null if nothing. */
function unexpired(item, limit) {
    if (item.kind !== 'swipe') {
        return item.deleted > limit ? item : null;
    }
    const swipes = item.swipes.filter(swipe => swipe.deleted > limit);
    return swipes.length ? { ...item, swipes, deleted: Math.min(...swipes.map(swipe => swipe.deleted)) } : null;
}

/** Items past their time, or over the most kept, are taken away (when ST starts, or the most changes). */
export function purge() {
    const limit = Date.now() - keepDays() * DAY;
    const max = keepCount();
    for (const [key, entry] of Object.entries(getSettings().trashIndex ?? {})) {
        // A file from before counts were kept is read once to learn its count
        if (entry.oldest > limit && (!max || (entry.count ?? Infinity) <= max)) {
            continue;
        }
        queued(async () => writeTrash(key, capped((await readTrash(key)).map(item => unexpired(item, limit)).filter(Boolean))))
            .catch(error => console.error(`[${MODULE}] Trash cleanup failed`, error));
    }
}

export function applyMessageTrash() {
    const on = isOn('messageTrash');
    const item = document.getElementById(OPTION_ID);
    if (item) {
        item.hidden = !on;
    }
    showCount();
    if (on) {
        batch || snapshot();
    } else {
        // Nothing is kept while off
        shadow = [];
        swipeShadow = new Map();
        if (wasOn && getSettings().messageTrash === false && Object.keys(getSettings().trashIndex ?? {}).length) {
            // Switched off itself (not the whole extension)
            ask('휴지통', '휴지통에 남은 메시지를 모두 지울까요? 남겨 두면 보관 기간이 지난 뒤 지워집니다.', '비우기', '남겨 두기')
                .then(yes => yes && clearAll());
        }
    }
    wasOn = on;
}

export function initMessageTrash() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    const refresh = [
        eventTypes.CHAT_CHANGED, eventTypes.MESSAGE_SENT, eventTypes.MESSAGE_RECEIVED, eventTypes.MESSAGE_SWIPED,
        eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_EDITED, eventTypes.GENERATION_ENDED,
        eventTypes.USER_MESSAGE_RENDERED, eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.MORE_MESSAGES_LOADED,
    ];
    refresh.filter(Boolean).forEach(type => eventSource.on(type, remember));
    // Before other extensions' handlers, which may report changes of their own
    const first = (type, handler) => type && (typeof eventSource.makeFirst === 'function' ? eventSource.makeFirst(type, handler) : eventSource.on(type, handler));
    first(eventTypes.MESSAGE_DELETED, onDeleted);
    first(eventTypes.MESSAGE_SWIPE_DELETED, onSwipeDeleted);
    eventSource.on(eventTypes.CHAT_CHANGED, relinkOpenChat);
    eventSource.on(eventTypes.CHAT_CHANGED, showCount);
    // Leaving the page: what is being gathered goes now (as far as the page lets it)
    window.addEventListener('pagehide', () => batch && flush(true));
    isOn('messageTrash') && sendPending();
    eventSource.on(eventTypes.CHAT_DELETED, name => onChatDeleted('c', name));
    eventSource.on(eventTypes.GROUP_CHAT_DELETED, name => onChatDeleted('g', name));
    eventSource.on(eventTypes.CHARACTER_DELETED, data => data?.character?.avatar && forget(entry => entry.kind === 'c' && entry.owner === data.character.avatar));
    eventTypes.CHAT_RENAMED && eventSource.on(eventTypes.CHAT_RENAMED, onRenamed);

    const menu = document.querySelector('#options .options-content');
    if (menu) {
        const item = document.createElement('a');
        item.id = OPTION_ID;
        item.innerHTML = '<i class="fa-lg fa-solid fa-trash-can-arrow-up"></i><span>휴지통</span>';
        item.addEventListener('click', () => {
            // Close the Options menu the way its own button does
            if (document.getElementById('options')?.style.display !== 'none') {
                document.getElementById('options_button')?.click();
            }
            openTrash().catch(error => console.error(`[${MODULE}] Trash failed`, error));
        });
        menu.append(item);
    }
    wasOn = isOn('messageTrash');
    applyMessageTrash();
    purge();
}
