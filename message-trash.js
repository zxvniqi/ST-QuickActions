// 휴지통: messages deleted from a chat, whichever way (ST's delete, range delete, /cut, the last
// message...), and swipes deleted one by one, are kept for a while and can be put back where they
// were. Kept on the server (user files), one file per chat, so every device sees the same trash;
// the settings hold only an index of those files.
import { MODULE, getSettings, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_trash';
const TITLE = '편의성 모음';
const FILE_PREFIX = 'stqa-trash-';
const DAY = 24 * 60 * 60 * 1000;

// The chat's messages as they were before the latest deletion, to tell which ones went, and each
// message's swipes (a deleted swipe is gone from the message itself)
let shadow = [];
let shadowKey = null;
let swipeShadow = new Map();
let wasOn = false;
// Deletions our own code makes on the way to something else (not the user's)
let paused = 0;
// Trash files are read and written one change at a time
let writing = Promise.resolve();

const isGenerating = () => Boolean(document.getElementById('mes_stop')?.offsetParent);
const queued = task => (writing = writing.then(task, task));
const keepDays = () => Math.min(30, Math.max(1, Math.round(Number(getSettings().trashDays)) || 7));
// Most items one chat's trash keeps (0: no limit)
const keepCount = () => Math.max(0, Math.round(Number(getSettings().trashMax)) || 0);
const save = () => SillyTavern.getContext().saveSettingsDebounced();
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

async function readTrash(key) {
    const entry = getSettings().trashIndex?.[key];
    if (!entry) {
        return [];
    }
    try {
        const response = await fetch(`/user/files/${entry.file}`, { cache: 'no-store' });
        const data = response.ok ? await response.json() : null;
        return Array.isArray(data?.items) ? data.items : [];
    } catch {
        return [];
    }
}

async function deleteFile(file) {
    await fetch('/api/files/delete', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ path: `user/files/${file}` }),
    }).catch(() => {});
}

/** Writes a chat's trash (an empty one takes its file away). `chat` is needed for a new file. */
async function writeTrash(key, items, chat = null) {
    const settings = getSettings();
    settings.trashIndex ??= {};
    let entry = settings.trashIndex[key];
    if (!items.length) {
        if (entry) {
            await deleteFile(entry.file);
            delete settings.trashIndex[key];
            save();
        }
        return;
    }
    if (!entry) {
        entry = { file: `${FILE_PREFIX}${hash(key)}-${Date.now().toString(36)}.json`, kind: chat.kind, owner: chat.owner, chat: chat.chat };
    }
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ name: entry.file, data: toBase64(JSON.stringify({ items })) }),
    });
    if (!response.ok) {
        throw new Error(`Trash not saved (${response.status})`);
    }
    entry.oldest = Math.min(...items.map(item => item.deleted));
    entry.count = items.length;
    settings.trashIndex[key] = entry;
    save();
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

/** Adds to a chat's trash; a failure is told (the deletion itself stands). */
function addToTrash(key, chat, change) {
    queued(async () => {
        const items = await readTrash(key);
        change(items);
        await writeTrash(key, capped(items), chat);
    }).catch((error) => {
        console.error(`[${MODULE}] Trash failed`, error);
        toastr.error('지운 메시지를 휴지통에 옮기지 못했습니다.', TITLE);
    });
}

// Deletions in a row (a range is deleted one message at a time) are gathered into one item
const GATHER_MS = 300;
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
    const swipes = new Map();
    for (const message of chat) {
        if (Array.isArray(message.swipes) && message.swipes.length > 1) {
            swipes.set(message, swipesOf(message, swipeShadow.get(message)));
        }
    }
    swipeShadow = swipes;
}

/** The chat changed some other way: the snapshot follows it. */
function remember() {
    // Off: nothing is kept, so nothing is copied either
    if (!isOn('messageTrash') || gathering) {
        // (Deletions being gathered: the chat as it was before them is kept until they are taken)
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
    if (paused) {
        return;
    }
    clearTimeout(gathering);
    gathering = setTimeout(collect, GATHER_MS);
}

/** The messages that were there before and are gone now go to the trash. */
function collect() {
    clearTimeout(gathering);
    gathering = null;
    const before = shadow;
    const key = shadowKey;
    snapshot();
    const chat = openChat();
    if (!isOn('messageTrash') || !chat || chat.key !== key) {
        return;
    }
    const now = new Set(SillyTavern.getContext().chat);
    const gone = new Set(before.filter(message => !now.has(message)));
    // Nothing of before left in a chat that has messages: it was loaded again, nothing was deleted
    if (!gone.size || (now.size && gone.size === before.length)) {
        return;
    }
    const messages = [];
    before.forEach((message, index) => {
        if (!gone.has(message)) {
            return;
        }
        // The nearest message before it that stays: where it goes back
        let previous = index - 1;
        while (previous >= 0 && gone.has(before[previous])) {
            previous--;
        }
        messages.push({ index, anchor: previous >= 0 ? fingerprint(before[previous]) : null, message: copy(message) });
    });
    const item = { id: newId(), deleted: Date.now(), messages };
    addToTrash(key, chat, items => items.push(item));
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
    paused++;
    try {
        return await task();
    } finally {
        paused--;
        if (!paused && isOn('messageTrash')) {
            clearTimeout(gathering);
            gathering = null;
            snapshot();
        }
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
            const found = findNear(chat, run[0].anchor, run[0].index - 1);
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
    const found = item.anchor === null ? -1 : findNear(chat, item.anchor, item.index - 1);
    const candidate = item.anchor === null ? chat[0] : found === -1 ? null : chat[found + 1];
    if (candidate && candidate.name === item.name && !candidate.is_user) {
        if (!Array.isArray(candidate.swipes) || !candidate.swipes.length) {
            candidate.swipes = [candidate.mes];
            candidate.swipe_info = [{ send_date: candidate.send_date, gen_started: candidate.gen_started, gen_finished: candidate.gen_finished, extra: copy(candidate.extra ?? {}) }];
            candidate.swipe_id = 0;
        }
        if (!Array.isArray(candidate.swipe_info)) {
            candidate.swipe_info = candidate.swipes.map(() => ({}));
        }
        for (const swipe of sorted) {
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
    first.send_date && (message.send_date = first.send_date);
    first.extra && (message.extra = copy(first.extra));
    const at = item.anchor === null ? 0 : found === -1 ? Math.min(item.index, chat.length) : found + 1;
    chat.splice(at, 0, message);
}

/** Puts trash back into the open chat. `picks`: [{ item, entries }] (messages, or a message's swipes). */
async function restore(picks) {
    const context = SillyTavern.getContext();
    const chat = context.chat;
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

const plain = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function formatTime(time) {
    const date = new Date(time);
    const pad = number => String(number).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** One message (or swipe) in full, drawn the way the chat draws it. */
export function showFullText(title, text, message) {
    const context = SillyTavern.getContext();
    const view = document.createElement('div');
    view.className = 'stqa_trash_view';
    view.innerHTML = '<h3></h3><div class="mes_text"></div>';
    view.querySelector('h3').textContent = title;
    const box = view.querySelector('.mes_text');
    if (typeof context.messageFormatting === 'function') {
        box.innerHTML = context.messageFormatting(String(text ?? ''), message?.name ?? '', Boolean(message?.is_system), Boolean(message?.is_user), -1);
    } else {
        box.textContent = String(text ?? '');
    }
    new context.Popup(view, context.POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, allowVerticalScrolling: true }).show();
}

async function openTrash() {
    const chat = openChat();
    if (!chat) {
        toastr.info('열린 채팅이 없습니다.', TITLE);
        return;
    }
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
        await restore(picks);
        await removePicked(chat.key, picked);
        toastr.success(`${picked.size}개를 되살렸습니다.`, TITLE);
    });

    const render = async () => {
        const items = (await readTrash(chat.key)).sort((a, b) => b.deleted - a.deleted);
        const days = keepDays();
        content.innerHTML = '<h3>휴지통</h3><div class="stqa_hint"></div><div class="stqa_trash_items"></div>';
        content.querySelector('.stqa_hint').textContent = `지운 지 ${days}일이 지나면 완전히 삭제됩니다.`;
        content.classList.toggle('stqa_trash_picking', picking);
        const list = content.querySelector('.stqa_trash_items');
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
        const count = () => {
            const ticked = ticks.filter(([, , box]) => box.checked).length;
            restoreTicked.querySelector('span').textContent = `선택한 ${ticked}개 되살리기`;
            restoreTicked.hidden = !ticked;
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
                const line = tick('stqa_trash_message', `${swipes ? `스와이프 ${entry.at + 1}` : title}: ${plain(text).slice(0, 100) || '(빈 메시지)'}`);
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
                        showFullText(title, text, swipes ? item.template : entry.message);
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
                count();
            }
        });
        bottom.append(restoreTicked, pickButton, button('fa-dumpster', '휴지통 비우기', async () => {
            if (await ask('휴지통 비우기', '이 채팅의 휴지통을 모두 지웁니다. 되돌릴 수 없습니다.', '비우기')) {
                await change(() => writeTrash(chat.key, []));
            }
        }, true));
    };

    await render();
    await new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true }).show();
}

/** Every chat's trash taken away (the feature switched off and the user said so). */
function clearAll() {
    return queued(async () => {
        const settings = getSettings();
        for (const entry of Object.values(settings.trashIndex ?? {})) {
            await deleteFile(entry.file);
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
                await deleteFile(entry.file);
                delete settings.trashIndex[key];
            }
        }
        save();
    });
}

/** A renamed chat keeps its trash. */
function onRenamed({ avatarId, groupId, oldFileName, newFileName }) {
    const settings = getSettings();
    const kind = groupId ? 'g' : 'c';
    const owner = groupId || avatarId;
    const oldKey = `${kind}:${owner}:${stripExtension(oldFileName)}`;
    const entry = settings.trashIndex?.[oldKey];
    if (!entry) {
        return;
    }
    const chat = stripExtension(newFileName);
    delete settings.trashIndex[oldKey];
    settings.trashIndex[`${kind}:${owner}:${chat}`] = { ...entry, chat };
    save();
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
    if (on) {
        gathering || snapshot();
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
    eventSource.on(eventTypes.CHAT_DELETED, name => forget(entry => entry.kind === 'c' && entry.chat === stripExtension(name)));
    eventSource.on(eventTypes.GROUP_CHAT_DELETED, name => forget(entry => entry.kind === 'g' && entry.chat === stripExtension(name)));
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
