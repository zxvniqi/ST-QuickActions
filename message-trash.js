// 휴지통: messages deleted from a chat, whichever way (ST's delete, range delete, /cut, the last
// message...), are kept for a while and can be put back where they were. Swipes deleted one by
// one are not. Kept on the server (user files), one file per chat, so every device sees the same
// trash; the settings hold only an index of those files.
import { MODULE, getSettings, isOn } from './settings.js';

const OPTION_ID = 'stqa_option_trash';
const TITLE = '편의성 모음';
const FILE_PREFIX = 'stqa-trash-';
const DAY = 24 * 60 * 60 * 1000;

// The chat's messages as they were before the latest deletion, to tell which ones went
let shadow = [];
let shadowKey = null;
let wasOn = false;
// Trash files are read and written one change at a time
let writing = Promise.resolve();

const isGenerating = () => Boolean(document.getElementById('mes_stop')?.offsetParent);
const queued = task => (writing = writing.then(task, task));
const keepDays = () => Math.min(30, Math.max(1, Math.round(Number(getSettings().trashDays)) || 7));
const save = () => SillyTavern.getContext().saveSettingsDebounced();
const stripExtension = name => String(name ?? '').replace(/\.jsonl$/, '');

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
    settings.trashIndex[key] = entry;
    save();
}

// Deletions in a row (a range is deleted one message at a time) are gathered into one item
const GATHER_MS = 300;
let gathering = null;

function snapshot() {
    shadow = SillyTavern.getContext().chat.slice();
    shadowKey = openChat()?.key ?? null;
}

/** The chat changed some other way: deletions still being gathered are taken first. */
function remember() {
    if (gathering) {
        collect();
    } else {
        snapshot();
    }
}

function onDeleted() {
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
    if (!gone.size) {
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
        messages.push({ index, anchor: previous >= 0 ? fingerprint(before[previous]) : null, message: JSON.parse(JSON.stringify(message)) });
    });
    const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, deleted: Date.now(), messages };
    queued(async () => {
        const items = await readTrash(key);
        items.push(item);
        await writeTrash(key, items, chat);
    }).catch((error) => {
        console.error(`[${MODULE}] Trash failed`, error);
        toastr.error('지운 메시지를 휴지통에 옮기지 못했습니다.', TITLE);
    });
}

/** Puts a trash item's messages back where they were in the open chat. */
async function restore(key, item) {
    const context = SillyTavern.getContext();
    const chat = context.chat;
    const sorted = [...item.messages].sort((a, b) => a.index - b.index);
    // Runs of messages that were next to each other go back together, after the same message
    const runs = [];
    for (const entry of sorted) {
        const last = runs[runs.length - 1];
        last && last[0].anchor === entry.anchor ? last.push(entry) : runs.push([entry]);
    }
    for (const run of runs) {
        let at = 0;
        if (run[0].anchor !== null) {
            // The matching message nearest to where it was (two may look the same)
            let best = -1;
            chat.forEach((message, index) => {
                if (fingerprint(message) === run[0].anchor && (best === -1 || Math.abs(index - run[0].index) < Math.abs(best - run[0].index))) {
                    best = index;
                }
            });
            at = best === -1 ? Math.min(run[0].index, chat.length) : best + 1;
        }
        chat.splice(at, 0, ...run.map(entry => entry.message));
    }
    await context.saveChat();
    await context.reloadCurrentChat();
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

    const render = async () => {
        const items = (await readTrash(chat.key)).sort((a, b) => b.deleted - a.deleted);
        const days = keepDays();
        content.innerHTML = '<h3>휴지통</h3><div class="stqa_hint"></div><div class="stqa_trash_items"></div>';
        content.querySelector('.stqa_hint').textContent = `이 채팅에서 지운 메시지입니다. 지운 지 ${days}일이 지나면 완전히 지워집니다.`;
        const list = content.querySelector('.stqa_trash_items');
        if (!items.length) {
            list.innerHTML = '<div class="stqa_hint">휴지통이 비어 있습니다.</div>';
            return;
        }
        for (const item of items) {
            const block = document.createElement('div');
            block.className = 'stqa_trash_item';
            const head = document.createElement('div');
            head.className = 'stqa_trash_head';
            const left = Math.max(0, Math.ceil((item.deleted + days * DAY - Date.now()) / DAY));
            head.textContent = `${formatTime(item.deleted)} 지움 · ${item.messages.length}개 · ${left}일 남음`;
            block.append(head);
            for (const { index, message } of [...item.messages].sort((a, b) => a.index - b.index)) {
                const line = document.createElement('div');
                line.className = 'stqa_trash_message';
                line.textContent = `#${index} ${message.name ?? ''}: ${plain(message.mes).slice(0, 100) || '(빈 메시지)'}`;
                block.append(line);
            }
            const actions = document.createElement('div');
            actions.className = 'stqa_trash_actions';
            actions.append(
                button('fa-rotate-left', '되살리기', () => change(async () => {
                    await restore(chat.key, item);
                    await writeTrash(chat.key, (await readTrash(chat.key)).filter(other => other.id !== item.id));
                    toastr.success(`${item.messages.length}개를 되살렸습니다.`, TITLE);
                })),
                button('fa-trash', '바로 삭제', async () => {
                    if (await ask('바로 삭제', '되돌릴 수 없습니다.', '삭제')) {
                        await change(async () => writeTrash(chat.key, (await readTrash(chat.key)).filter(other => other.id !== item.id)));
                    }
                }, true),
            );
            block.append(actions);
            list.append(block);
        }
        content.append(button('fa-dumpster', '휴지통 비우기', async () => {
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

/** Items past their time are taken away (when ST starts: nothing runs while it is off). */
function purge() {
    const limit = Date.now() - keepDays() * DAY;
    for (const [key, entry] of Object.entries(getSettings().trashIndex ?? {})) {
        if (entry.oldest > limit) {
            continue;
        }
        queued(async () => writeTrash(key, (await readTrash(key)).filter(item => item.deleted > limit)))
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
    } else if (wasOn && getSettings().messageTrash === false && Object.keys(getSettings().trashIndex ?? {}).length) {
        // Switched off itself (not the whole extension)
        ask('휴지통', '휴지통에 남은 메시지를 모두 지울까요? 남겨 두면 보관 기간이 지난 뒤 지워집니다.', '비우기', '남겨 두기')
            .then(yes => yes && clearAll());
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
    eventSource.on(eventTypes.MESSAGE_DELETED, onDeleted);
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
