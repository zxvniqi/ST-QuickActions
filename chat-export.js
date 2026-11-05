// "전체 내보내기" / "전체 불러오기" in the chat list (Chat History) window: every chat of the
// character in one zip file, each chat as the .jsonl ST itself saves; and such a zip (or .jsonl
// files) put back into the character under the chats' own names.
import { isOn } from './settings.js';

const TITLE = '편의성 모음';
const BUTTON_ID = 'stqa_export_all_chats';
const IMPORT_ID = 'stqa_import_all_chats';
const PAIR_ID = 'stqa_chat_io';

// CRC-32 table for the zip format
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** A zip of the files as they are (stored, not compressed), names in UTF-8. */
function makeZip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const { name, data } of files) {
        const nameBytes = encoder.encode(name);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034B50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // UTF-8 names
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        parts.push(local, nameBytes, data);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014B50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(12, time, true);
        entry.setUint16(14, date, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, data.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, nameBytes.length, true);
        entry.setUint32(42, offset, true);
        central.push(entry, nameBytes);
        offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

const safeName = name => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'chat';

/** The character open now (not a group), or none. */
function openCharacter() {
    const context = SillyTavern.getContext();
    return context.groupId ? null : context.characters[context.characterId];
}

/** Every chat of the character (the open one by default) in one zip file, downloaded. */
export async function exportAllChats(character = openCharacter()) {
    const context = SillyTavern.getContext();
    if (!character) {
        toastr.info('캐릭터 채팅에서만 쓸 수 있습니다.', TITLE);
        return;
    }
    const headers = context.getRequestHeaders();
    const listed = await fetch('/api/characters/chats', { method: 'POST', headers, body: JSON.stringify({ avatar_url: character.avatar }) });
    const list = listed.ok ? Object.values(await listed.json()) : [];
    const names = list.map(item => item?.file_name).filter(Boolean).map(name => String(name).replace(/\.jsonl$/, ''));
    if (!names.length) {
        toastr.info('내보낼 채팅이 없습니다.', TITLE);
        return;
    }
    const toast = toastr.info(`채팅 ${names.length}개를 모으는 중…`, TITLE, { timeOut: 0, extendedTimeOut: 0 });
    const encoder = new TextEncoder();
    const files = [];
    let failed = 0;
    try {
        for (const name of names) {
            const response = await fetch('/api/chats/get', { method: 'POST', headers, body: JSON.stringify({ ch_name: character.name, file_name: name, avatar_url: character.avatar }) });
            const lines = response.ok ? await response.json() : null;
            if (!Array.isArray(lines) || !lines.length) {
                failed++;
                continue;
            }
            files.push({ name: `${safeName(name)}.jsonl`, data: encoder.encode(lines.map(line => JSON.stringify(line)).join('\n')) });
        }
    } finally {
        toastr.clear(toast);
    }
    if (!files.length) {
        toastr.error('채팅을 읽지 못했습니다.', TITLE);
        return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(makeZip(files));
    link.download = `${safeName(character.name)} 채팅 전체.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    failed ? toastr.warning(`${files.length}개를 내보냈고, ${failed}개는 읽지 못했습니다.`, TITLE) : toastr.success(`채팅 ${files.length}개를 내보냈습니다.`, TITLE);
}

/** The .jsonl files in a zip (stored or deflated, as zip tools make them). */
async function readZip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // The end record is in the last 64 KB (after an optional comment)
    let end = -1;
    for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65557); at--) {
        if (view.getUint32(at, true) === 0x06054B50) {
            end = at;
            break;
        }
    }
    if (end < 0) {
        throw new Error('Not a zip file');
    }
    const decoder = new TextDecoder();
    const files = [];
    let at = view.getUint32(end + 16, true);
    for (let i = 0; i < view.getUint16(end + 10, true); i++) {
        const method = view.getUint16(at + 10, true);
        const size = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const local = view.getUint32(at + 42, true);
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
        at += 46 + nameLength + extraLength + commentLength;
        if (!/\.jsonl$/i.test(name) || (method !== 0 && method !== 8)) {
            continue;
        }
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = bytes.subarray(start, start + size);
        const data = method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        files.push({ name: name.split('/').pop(), text: decoder.decode(data) });
    }
    return files;
}

/**
 * Chats from a zip made by 전체 내보내기 (or any zip of .jsonl) or .jsonl files, saved to the
 * character (the open one by default) under their own names; a name already there gets (2).
 * Chats already there are never written to. Returns the names saved.
 */
export async function importChatFiles(picked, character = openCharacter()) {
    const context = SillyTavern.getContext();
    if (!character) {
        toastr.info('캐릭터 채팅에서만 쓸 수 있습니다.', TITLE);
        return [];
    }
    const chats = [];
    for (const file of picked) {
        if (/\.zip$/i.test(file.name)) {
            chats.push(...await readZip(await file.arrayBuffer()));
        } else if (/\.jsonl$/i.test(file.name)) {
            chats.push({ name: file.name, text: await file.text() });
        }
    }
    if (!chats.length) {
        toastr.info('불러올 채팅(.jsonl)이 없습니다.', TITLE);
        return [];
    }
    const headers = context.getRequestHeaders();
    const listed = await fetch('/api/characters/chats', { method: 'POST', headers, body: JSON.stringify({ avatar_url: character.avatar, simple: true }) });
    const taken = new Set((listed.ok ? Object.values(await listed.json()) : []).map(item => String(item?.file_name ?? '').replace(/\.jsonl$/, '')));
    const saved = [];
    let failed = 0;
    for (const { name, text } of chats) {
        try {
            const lines = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
            // ST chats start with a header line (user_name / character_name / chat_metadata)
            if (!lines.length || !(lines[0].chat_metadata !== undefined || lines[0].user_name !== undefined)) {
                throw new Error('Not an ST chat');
            }
            const base = safeName(name.replace(/\.jsonl$/i, ''));
            let fileName = base;
            for (let n = 2; taken.has(fileName); n++) {
                fileName = `${base} (${n})`;
            }
            const response = await fetch('/api/chats/save', { method: 'POST', headers, body: JSON.stringify({ ch_name: character.name, file_name: fileName, chat: lines, avatar_url: character.avatar }) });
            if (!response.ok) {
                throw new Error(`Saving failed: ${response.status}`);
            }
            taken.add(fileName);
            saved.push(fileName);
        } catch (error) {
            console.error(`[${TITLE}] Importing ${name} failed`, error);
            failed++;
        }
    }
    failed ? toastr.warning(`${saved.length}개를 불러왔고, ${failed}개는 불러오지 못했습니다.`, TITLE) : toastr.success(`채팅 ${saved.length}개를 불러왔습니다.`, TITLE);
    return saved;
}

export function applyChatExport() {
    const pair = document.getElementById(PAIR_ID);
    if (pair) {
        pair.style.display = isOn('chatExportAll') ? '' : 'none';
    }
}

/** A button built like the header's own (✚ New Chat...), icon only: phones have no room for words. */
function headerButton(id, icon, title, onClick) {
    const button = document.createElement('div');
    button.id = id;
    button.className = 'menu_button menu_button_icon';
    button.title = title;
    // The invisible character gives it a line of text, so it is as tall as the worded buttons
    button.innerHTML = `<i class="fa-solid ${icon}"></i>&#8203;`;
    button.addEventListener('click', onClick);
    return button;
}

export function initChatExport() {
    const anchor = document.getElementById('chat_import_button');
    if (anchor && !document.getElementById(BUTTON_ID)) {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = '.zip,.jsonl';
        picker.multiple = true;
        picker.hidden = true;
        picker.addEventListener('change', () => {
            const files = [...picker.files];
            picker.value = '';
            importChatFiles(files).then((saved) => {
                // ST's chat list shows them once opened again (as ST's own ✎ does)
                if (saved.length && document.getElementById('shadow_select_chat_popup')?.offsetParent) {
                    $('#option_select_chat').trigger('click');
                    $('#options').hide();
                }
            }).catch((error) => {
                console.error(`[${TITLE}] Importing chats failed`, error);
                toastr.error('불러오지 못했습니다.', TITLE);
            });
        });
        const exporter = headerButton(BUTTON_ID, 'fa-file-zipper', '전체 내보내기: 이 캐릭터의 채팅을 모두 zip 파일 하나로 내려받습니다', () => exportAllChats(openCharacter()).catch((error) => {
            console.error(`[${TITLE}] Exporting chats failed`, error);
            toastr.error('내보내지 못했습니다.', TITLE);
        }));
        const importer = headerButton(IMPORT_ID, 'fa-folder-open', '전체 불러오기: 전체 내보내기로 받은 zip 파일(또는 .jsonl 여러 개)을 이 캐릭터에 불러옵니다', () => picker.click());
        // Right after Import Chat, as one item; the header's spacing is evened out in CSS
        const pair = document.createElement('div');
        pair.id = PAIR_ID;
        pair.append(exporter, importer, picker);
        anchor.after(pair);
    }
    applyChatExport();
}
