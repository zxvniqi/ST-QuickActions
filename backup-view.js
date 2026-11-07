// ST's chat backups list (Chat History → Backups), made easier to use: only the open character's
// (or group's) backups are listed, with their time, number of messages and last message, and the
// eye button shows a backup as a chat, with what the chat open now lacks marked. ST's own restore
// (a new chat, the open one untouched) and delete buttons stay as they are.
import { MODULE, isOn } from './settings.js';

const TITLE = '편의성 모음';
const LIST = '.chatBackupsList';
const ITEM = '.chatBackupsListItem';
const OTHER_CLASS = 'stqa_backup_other';

// Whether the other characters' backups are shown too (per list opening)
let showAll = false;
// Backup file name -> its last message, from ST's own backups list
let previews = new Map();

/** SHA-256 of a text (UTF-8), in hex: ST names backups of non-ASCII names with part of it. */
function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const length = bytes.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, length * 8);
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
    const w = new Uint32Array(64);
    const rotate = (x, n) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
            const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        [a, b, c, d, e, f, g, hh].forEach((value, i) => (h[i] = (h[i] + value) | 0));
    }
    return h.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

/** How ST names the backups of a card (its avatar file without .png) or of a group (its id). */
function backupKey(name) {
    const sanitized = name.replace(/[/?<>\\:*|"\u0000-\u001f\u0080-\u009f]/g, '').replace(/[. ]+$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return /[^\x20-\x7E]/.test(name) ? `${sanitized}_${sha256(name).slice(0, 8)}` : sanitized;
}

/** The start of the open character's (or group's) backup file names. */
function ownPrefix() {
    const context = SillyTavern.getContext();
    const owner = context.groupId ? String(context.groupId) : context.characters[context.characterId]?.avatar?.replace(/\.png$/, '');
    return owner ? `chat_${backupKey(owner)}_` : null;
}

const isOwn = (file, prefix) => Boolean(prefix) && file.startsWith(prefix) && /^\d{8}-\d{6}\.jsonl$/.test(file.slice(prefix.length));

/** "20261107-102011" in a backup file name, as a readable time. */
function timeOf(file) {
    const match = file.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.jsonl$/);
    return match ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}:${match[6]}` : file;
}

const plain = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const fingerprint = message => `${message.send_date}\u0001${message.name}\u0001${message.mes}`;

async function loadPreviews() {
    try {
        const response = await fetch('/api/backups/chat/get', { method: 'POST', headers: SillyTavern.getContext().getRequestHeaders() });
        const list = response.ok ? await response.json() : [];
        previews = new Map(list.map(backup => [backup.file_name, backup.mes]));
    } catch {
        previews = new Map();
    }
}

/** Shows a backup as a chat; messages the open chat doesn't have (or has differently) are marked. */
async function viewBackup(file, item) {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;
    const response = await fetch('/api/backups/chat/download', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ name: file }),
    });
    if (!response.ok) {
        toastr.error('백업을 불러오지 못했습니다.', TITLE);
        return;
    }
    const messages = [];
    let header = null;
    for (const line of (await response.text()).split('\n')) {
        try {
            const data = JSON.parse(line);
            if (typeof data?.mes === 'string') {
                messages.push(data);
            } else if (data?.chat_metadata && !header) {
                header = data;
            }
        } catch {
            // A broken line
        }
    }
    // A backup of the chat open now? (a character's backups are of all its chats) Each chat file
    // has its own mark; older ones without it are told by their first message (made with the chat)
    const integrity = header?.chat_metadata?.integrity;
    const sameChat = integrity
        ? integrity === context.chatMetadata?.integrity
        : Boolean(messages[0] && context.chat[0]) && fingerprint(messages[0]) === fingerprint(context.chat[0]);
    // Compared with the chat open now: same message (time, name and text), same time and name but
    // another text (edited since), or not there at all (deleted since)
    const now = new Set(context.chat.map(fingerprint));
    const nowByTime = new Set(context.chat.map(message => `${message.send_date}\u0001${message.name}`));
    const states = messages.map((message) => {
        if (!sameChat || now.has(fingerprint(message))) {
            return '';
        }
        return nowByTime.has(`${message.send_date}\u0001${message.name}`) ? 'changed' : 'missing';
    });
    const differing = states.filter(Boolean).length;

    const content = document.createElement('div');
    content.className = 'stqa_backup_view';
    content.innerHTML = `
        <h3></h3>
        <div class="stqa_hint"></div>
        <div class="stqa_backup_tools"></div>
        <div class="stqa_backup_messages"></div>`;
    content.querySelector('h3').textContent = timeOf(file);
    content.querySelector('.stqa_hint').textContent = !sameChat
        ? `메시지 ${messages.length}개 · 지금 열린 채팅이 아닌 다른 채팅의 백업이라 비교하지 않았습니다.`
        : differing
            ? `메시지 ${messages.length}개 · 지금 채팅의 백업 · 지금과 다른 메시지 ${differing}개 (표시된 것)`
            : `메시지 ${messages.length}개 · 지금 채팅의 백업 · 지금 채팅에 모두 있는 메시지입니다.`;
    const list = content.querySelector('.stqa_backup_messages');
    messages.forEach((message, index) => {
        const bubble = document.createElement('div');
        bubble.className = `stqa_backup_message${message.is_user ? ' stqa_backup_user' : ''}${states[index] ? ` stqa_backup_${states[index]}` : ''}`;
        bubble.innerHTML = '<div class="stqa_backup_name"><b></b><small></small></div><div class="mes_text"></div>';
        bubble.querySelector('b').textContent = `#${index} ${message.name ?? ''}`;
        bubble.querySelector('small').textContent = states[index] === 'missing' ? '지금 채팅에 없음' : states[index] === 'changed' ? '지금과 내용 다름' : '';
        const text = bubble.querySelector('.mes_text');
        if (typeof context.messageFormatting === 'function') {
            text.innerHTML = context.messageFormatting(message.mes, message.name ?? '', Boolean(message.is_system), Boolean(message.is_user), -1);
        } else {
            text.textContent = message.mes;
        }
        // Long messages are folded; a tap opens one
        bubble.addEventListener('click', () => bubble.classList.toggle('stqa_backup_open'));
        list.append(bubble);
    });

    const tools = content.querySelector('.stqa_backup_tools');
    const button = (icon, text, onClick) => {
        const element = document.createElement('div');
        element.className = 'menu_button menu_button_icon';
        element.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
        element.querySelector('span').textContent = text;
        element.addEventListener('click', onClick);
        return element;
    };
    let onlyDiffering = false;
    const filter = button('fa-filter', '다른 메시지만 보기', () => {
        onlyDiffering = !onlyDiffering;
        list.classList.toggle('stqa_backup_only_differing', onlyDiffering);
        filter.querySelector('span').textContent = onlyDiffering ? '모든 메시지 보기' : '다른 메시지만 보기';
    });
    differing && tools.append(filter);
    let popup = null;
    tools.append(button('fa-rotate-left', '새 채팅으로 불러오기', () => {
        // ST's own restore: the backup comes in as a new chat, the open one stays as it is
        popup?.completeCancelled();
        item.querySelector('.fa-rotate-left')?.click();
    }));

    popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true });
    await popup.show();
}

/** The list as ST drew it: other characters' backups hidden, the open one's made readable. */
async function decorate(list) {
    const prefix = ownPrefix();
    const items = [...list.querySelectorAll(`:scope > ${ITEM}`)];
    if (!items.length) {
        return;
    }
    if (!previews.size) {
        await loadPreviews();
    }
    let own = 0;
    for (const item of items) {
        const name = item.querySelector('.chatBackupsListItemName');
        const file = item.dataset.stqaFile ?? name?.textContent ?? '';
        item.dataset.stqaFile = file;
        const mine = isOwn(file, prefix);
        own += mine ? 1 : 0;
        item.classList.toggle(OTHER_CLASS, !mine);
        if (mine && name && !item.querySelector('.stqa_backup_preview')) {
            name.textContent = timeOf(file);
            name.title = file;
            const preview = document.createElement('div');
            preview.className = 'stqa_backup_preview';
            preview.textContent = plain(previews.get(file)).slice(0, 120);
            name.after(preview);
        }
    }
    list.classList.toggle('stqa_backup_show_all', showAll);
    let bar = list.querySelector(':scope > .stqa_backup_bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'stqa_backup_bar';
        bar.innerHTML = '<span></span><div class="menu_button menu_button_icon"><i class="fa-solid fa-users"></i><span></span></div>';
        bar.querySelector('.menu_button').addEventListener('click', () => {
            showAll = !showAll;
            list.classList.toggle('stqa_backup_show_all', showAll);
            bar.querySelector('.menu_button span').textContent = showAll ? '이 캐릭터 것만 보기' : '모든 캐릭터 보기';
        });
        list.prepend(bar);
    }
    bar.querySelector(':scope > span').textContent = prefix ? `이 캐릭터의 백업 ${own}개` : '열린 채팅이 없어 모든 백업을 보여 줍니다.';
    bar.querySelector('.menu_button span').textContent = showAll ? '이 캐릭터 것만 보기' : '모든 캐릭터 보기';
    list.classList.toggle('stqa_backup_no_owner', !prefix);
}

/** The eye button on one of the backups shows it as a chat (ours instead of ST's text box). */
function onListClick(event) {
    if (!isOn('backupView')) {
        return;
    }
    const eye = event.target.closest(`${ITEM} .fa-eye`);
    const item = eye?.closest(ITEM);
    if (!item?.dataset.stqaFile) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    viewBackup(item.dataset.stqaFile, item).catch(error => console.error(`[${MODULE}] Backup view failed`, error));
}

let watcher = null;

function watch(list) {
    if (list.dataset.stqaWatched) {
        return;
    }
    list.dataset.stqaWatched = '1';
    list.addEventListener('click', onListClick, true);
    // ST fills the list when it is opened (and empties it when closed)
    let pending = false;
    new MutationObserver(() => {
        if (pending || !isOn('backupView')) {
            return;
        }
        pending = true;
        // Once ST has added all of them
        setTimeout(() => {
            pending = false;
            if (!list.querySelector(`:scope > ${ITEM}`)) {
                showAll = false;
                previews = new Map();
                return;
            }
            decorate(list).catch(error => console.error(`[${MODULE}] Backup list failed`, error));
        }, 0);
    }).observe(list, { childList: true });
}

export function applyBackupView() {
    document.body.classList.toggle('stqa_backup_view_on', isOn('backupView'));
}

export function initBackupView() {
    // ST adds its list beside the chat list the first time the chat history is shown: only that
    // box is watched until then
    const found = document.querySelector(LIST);
    const box = document.getElementById('select_chat_div')?.parentNode;
    if (found) {
        watch(found);
    } else if (box) {
        watcher = new MutationObserver(() => {
            const list = box.querySelector(`:scope > ${LIST}`);
            if (list) {
                watcher.disconnect();
                watch(list);
            }
        });
        watcher.observe(box, { childList: true });
    }
    applyBackupView();
}
