// Guards chats against being saved over as empty. While a chat is being opened, ST briefly holds
// an empty chat with no integrity mark; a save fired in that moment (by ST's delayed save or by
// any extension) reaches the server, which only checks integrity when the save carries a mark,
// and the chat file is replaced by an empty one. Such saves (no messages, no mark) are stopped
// here; a chat emptied on purpose still carries its mark and saves as usual.
import { MODULE, getSettings } from './settings.js';

const TITLE = '편의성 모음';
const SAVE_URLS = ['/api/chats/save', '/api/chats/group/save'];
// Only small requests are looked into: an empty chat is tiny, real chats are not parsed
const MAX_LOOK = 200_000;

function isEmptyUnmarkedSave(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url || !SAVE_URLS.some(path => url.includes(path)) || String(init?.method).toUpperCase() !== 'POST') {
        return false;
    }
    if (typeof init.body !== 'string' || init.body.length > MAX_LOOK) {
        return false;
    }
    const body = JSON.parse(init.body);
    const chat = body?.chat;
    // The header line only (no messages), without an integrity mark, not a forced overwrite
    return Array.isArray(chat) && chat.length <= 1 && !chat[0]?.chat_metadata?.integrity && !body.force;
}

export function initSaveGuard() {
    const original = window.fetch;
    window.fetch = function (input, init) {
        try {
            if (getSettings().enabled !== false && isEmptyUnmarkedSave(input, init)) {
                console.warn(`[${MODULE}] Blocked saving an empty, unmarked chat over a chat file (a chat was being opened)`, input);
                toastr.warning('채팅을 여는 도중 빈 채팅으로 덮어쓰려는 저장을 막았습니다.', TITLE);
                return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
        } catch {
            // Anything unexpected: the request goes on as it was
        }
        return original.apply(this, arguments);
    };
}
