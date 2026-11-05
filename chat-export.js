// "전체 내보내기" in the chat list (Chat History) window: every chat of the character in one
// zip file, each chat as the .jsonl ST itself saves and imports.
import { isOn } from './settings.js';

const TITLE = '편의성 모음';
const BUTTON_ID = 'stqa_export_all_chats';

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

async function exportAllChats() {
    const context = SillyTavern.getContext();
    const character = context.characters[context.characterId];
    if (!character || context.groupId) {
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

export function applyChatExport() {
    const button = document.getElementById(BUTTON_ID);
    if (button) {
        // menu_button's own display would beat `hidden`
        button.style.display = isOn('chatExportAll') ? '' : 'none';
    }
}

export function initChatExport() {
    const anchor = document.getElementById('chat_import_button');
    if (anchor && !document.getElementById(BUTTON_ID)) {
        const button = document.createElement('div');
        button.id = BUTTON_ID;
        button.className = 'menu_button menu_button_icon';
        button.title = '이 캐릭터의 채팅을 모두 zip 파일 하나로 내려받습니다';
        button.innerHTML = '<i class="fa-solid fa-file-zipper"></i><span>전체 내보내기</span>';
        button.addEventListener('click', () => exportAllChats().catch((error) => {
            console.error(`[${TITLE}] Exporting chats failed`, error);
            toastr.error('내보내지 못했습니다.', TITLE);
        }));
        anchor.after(button);
    }
    applyChatExport();
}
