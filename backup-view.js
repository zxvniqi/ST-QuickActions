// ST's chat backups (Chat History → Backups), made easier to use: the button opens a window instead
// of a long list under the chats, with only the open character's (or group's) backups, by the time
// they were saved instead of their file name. A backup shows as a chat, with what the chat open now
// lacks marked; restoring makes a new chat (the open one untouched), as ST's own restore does.
import { MODULE, isOn } from './settings.js';
import { displayPastChats, importCharacterChat } from '../../../../script.js';
import { importGroupChat } from '../../../group-chats.js';

const TITLE = '편의성 모음';

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

/** The open character (or group): its name, and the start of its backup file names. */
function owner() {
    const context = SillyTavern.getContext();
    if (context.groupId) {
        const group = context.groups?.find(item => String(item.id) === String(context.groupId));
        return { name: group?.name ?? '그룹', prefix: `chat_${backupKey(String(context.groupId))}_` };
    }
    const character = context.characters[context.characterId];
    return character?.avatar ? { name: character.name, prefix: `chat_${backupKey(character.avatar.replace(/\.png$/, ''))}_` } : null;
}

const isOwn = (file, prefix) => Boolean(prefix) && file.startsWith(prefix) && /^\d{8}-\d{6}\.jsonl$/.test(file.slice(prefix.length));
const stamp = file => file.match(/(\d{8}-\d{6})\.jsonl$/)?.[1] ?? '';

/** "20261107-102011" in a backup file name, as a readable time. */
function timeOf(file) {
    const match = file.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.jsonl$/);
    return match ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}:${match[6]}` : file;
}

const fingerprint = message => `${message.send_date}\u0001${message.name}\u0001${message.mes}`;

function button(icon, text, onClick, caution = false) {
    const element = document.createElement('div');
    element.className = `menu_button menu_button_icon${caution ? ' caution' : ''}`;
    element.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    element.querySelector('span').textContent = text;
    element.addEventListener('click', onClick);
    return element;
}

/** ST's own restore: the backup comes in as a new chat of the open character, which then opens. */
async function restoreBackup(file) {
    const context = SillyTavern.getContext();
    const response = await fetch('/api/backups/chat/download', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ name: file }),
    });
    if (!response.ok) {
        toastr.error('백업을 불러오지 못했습니다.', TITLE);
        return false;
    }
    const form = new FormData();
    form.set('file_type', 'jsonl');
    form.set('avatar', new File([await response.blob()], file, { type: 'application/octet-stream' }));
    form.set('avatar_url', context.characters[context.characterId]?.avatar || '');
    form.set('user_name', context.name1);
    form.set('character_name', context.name2);
    const result = await (context.groupId ? importGroupChat : importCharacterChat)(form, { refresh: false });
    if (!result?.length) {
        toastr.error('백업을 새 채팅으로 불러오지 못했습니다.', TITLE);
        return false;
    }
    toastr.success(`새 채팅으로 불러왔습니다: ${result.join(', ')}`, TITLE);
    await displayPastChats(result);
    return true;
}

async function deleteBackup(file) {
    const response = await fetch('/api/backups/chat/delete', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ name: file }),
    });
    response.ok || toastr.error('백업을 지우지 못했습니다.', TITLE);
    return response.ok;
}

function ask(title, text, okButton) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.innerHTML = '<h3></h3><div></div>';
    content.querySelector('h3').textContent = title;
    content.querySelector('div').textContent = text;
    return new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton: '취소' }).show();
}

/** Shows a backup as a chat; messages the open chat doesn't have (or has differently) are marked. */
async function viewBackup(file, closeList) {
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
        <div class="stqa_backup_chips"></div>
        <div class="stqa_backup_tools"></div>
        <div class="stqa_backup_messages"></div>`;
    content.querySelector('h3').textContent = timeOf(file);
    // How many messages, whether it is this chat's backup, and how many differ from it now
    const chips = content.querySelector('.stqa_backup_chips');
    const chip = (icon, text, accent = false) => {
        const element = document.createElement('span');
        element.className = `stqa_backup_chip${accent ? ' stqa_backup_chip_accent' : ''}`;
        element.innerHTML = `<i class="fa-solid ${icon}"></i> `;
        element.append(text);
        chips.append(element);
    };
    chip('fa-comment', String(messages.length));
    chip(sameChat ? 'fa-link' : 'fa-link-slash', sameChat ? '지금 채팅' : '다른 채팅');
    differing && chip('fa-pen-to-square', `달라짐 ${differing}`, true);
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
    let onlyDiffering = false;
    const filter = button('fa-filter', '달라진 것만', () => {
        onlyDiffering = !onlyDiffering;
        list.classList.toggle('stqa_backup_only_differing', onlyDiffering);
        filter.querySelector('span').textContent = onlyDiffering ? '전체' : '달라진 것만';
    });
    differing && tools.append(filter);
    let popup = null;
    tools.append(button('fa-rotate-left', '새 채팅으로', async () => {
        if (await restoreBackup(file)) {
            popup?.completeCancelled();
            closeList?.();
        }
    }));

    popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true });
    await popup.show();
}

/** The backups window: the open character's backups, newest first (all of them on request). */
async function openBackups() {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;
    const response = await fetch('/api/backups/chat/get', { method: 'POST', headers: context.getRequestHeaders() });
    if (!response.ok) {
        toastr.error('백업 목록을 불러오지 못했습니다.', TITLE);
        return;
    }
    const backups = (await response.json()).sort((a, b) => stamp(b.file_name).localeCompare(stamp(a.file_name)));
    const who = owner();
    let showAll = !who;
    let popup = null;
    const content = document.createElement('div');
    content.className = 'stqa_trash stqa_backup_list';

    const render = () => {
        const shown = showAll ? backups : backups.filter(backup => isOwn(backup.file_name, who.prefix));
        content.innerHTML = '<div class="stqa_backup_head"><h3></h3></div><div class="stqa_trash_items stqa_backup_scroll"></div>';
        content.querySelector('h3').textContent = `${showAll ? '전체' : who.name} · 백업 ${shown.length}`;
        // The other characters' backups, or back to this one's
        if (who) {
            const toggle = button(showAll ? 'fa-user' : 'fa-users', showAll ? who.name : '전체', () => {
                showAll = !showAll;
                render();
            });
            toggle.title = showAll ? `${who.name}의 백업만` : '모든 캐릭터의 백업';
            content.querySelector('.stqa_backup_head').append(toggle);
        }
        const list = content.querySelector('.stqa_trash_items');
        if (!shown.length) {
            list.innerHTML = '<div class="stqa_hint">백업이 없습니다.</div>';
        }
        for (const backup of shown) {
            const card = document.createElement('div');
            card.className = 'stqa_trash_item stqa_backup_card';
            card.innerHTML = '<div class="stqa_backup_card_text"><b></b><small></small></div><div class="stqa_backup_card_actions"></div>';
            card.querySelector('b').textContent = timeOf(backup.file_name);
            const own = who && isOwn(backup.file_name, who.prefix);
            const small = card.querySelector('small');
            small.innerHTML = '<i class="fa-solid fa-comment"></i> ';
            small.append(`${backup.chat_items ?? '?'} · ${backup.file_size ?? ''}${own ? '' : ` · ${backup.file_name}`}`);
            const actions = card.querySelector('.stqa_backup_card_actions');
            const icon = (name, title, onClick, caution = false) => {
                const element = document.createElement('div');
                element.className = `menu_button fa-solid ${name}${caution ? ' caution' : ''}`;
                element.title = title;
                element.addEventListener('click', (event) => {
                    event.stopPropagation();
                    onClick();
                });
                actions.append(element);
            };
            const view = () => viewBackup(backup.file_name, () => popup?.completeCancelled())
                .catch(error => console.error(`[${MODULE}] Backup view failed`, error));
            icon('fa-eye', '보기', view);
            icon('fa-rotate-left', '새 채팅으로 불러오기', async () => {
                if (await restoreBackup(backup.file_name)) {
                    popup?.completeCancelled();
                }
            });
            icon('fa-trash', '백업 삭제', async () => {
                if (await ask('백업 삭제', `${timeOf(backup.file_name)} 백업을 지웁니다. 되돌릴 수 없습니다.`, '삭제') && await deleteBackup(backup.file_name)) {
                    backups.splice(backups.indexOf(backup), 1);
                    render();
                }
            }, true);
            card.addEventListener('click', view);
            list.append(card);
        }
    };

    render();
    popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기' });
    await popup.show();
}

/** ST's Backups button (beside the chat search) opens our window instead of its list. */
function onClick(event) {
    if (!isOn('backupView')) {
        return;
    }
    const target = event.target.closest('button, .menu_button');
    if (!target?.querySelector(':scope > .fa-box-open') || target.nextElementSibling?.id !== 'select_chat_search') {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    openBackups().catch(error => console.error(`[${MODULE}] Backups failed`, error));
}

export function applyBackupView() {
    document.body.classList.toggle('stqa_backup_view_on', isOn('backupView'));
}

export function initBackupView() {
    document.addEventListener('click', onClick, true);
    applyBackupView();
}
