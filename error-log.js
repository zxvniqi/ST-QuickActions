// Error details behind an error notice: the 🔍 on a red notice shows what went wrong, with Copy
// and Close. Kept in memory only, the last few: requests the server answered with an error (its
// answer as sent, which for a failed reply is the API's own error, much as the server console
// shows it), errors in the page's scripts, and the error notices themselves. The server's
// console itself can't be read from the page.
import { MODULE, isOn } from './settings.js';

const KEEP = 30;
const MAX_TEXT = 4000;
const TITLE = '편의성 모음';

/** @type {{ time: Date, kind: string, title: string, detail: string }[]} */
const entries = [];

function add(kind, title, detail = '', time = new Date()) {
    // Off: nothing is gathered
    if (!isOn('errorLog')) {
        return;
    }
    entries.push({ time, kind, title: String(title ?? '').slice(0, 300), detail: String(detail ?? '').slice(0, MAX_TEXT) });
    // In time order (an answer is read a moment after it arrives)
    entries.sort((a, b) => a.time - b.time);
    entries.splice(0, Math.max(0, entries.length - KEEP));
}

const short = url => String(url ?? '').replace(location.origin, '').split('?')[0];

/** Requests answered with an error: their address, status and answer (read from a copy). */
function watchRequests() {
    const original = window.fetch;
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input?.url;
        const request = original.apply(this, arguments);
        request.then((response) => {
            if (response.ok) {
                return;
            }
            const time = new Date();
            const title = `${response.status} ${response.statusText} · ${short(url)}`;
            response.clone().text()
                .then(text => add('요청 오류', title, text, time))
                .catch(() => add('요청 오류', title, '', time));
        }, (error) => {
            // A request stopped on purpose (the user pressed Stop) isn't an error
            if (error?.name !== 'AbortError') {
                add('연결 오류', `${short(url)}`, error?.message ?? error);
            }
        });
        return request;
    };
}

function watchScripts() {
    window.addEventListener('error', event => add('스크립트 오류', event.message, event.error?.stack ?? `${event.filename}:${event.lineno}`));
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        if (reason?.name !== 'AbortError') {
            add('스크립트 오류', reason?.message ?? String(reason), reason?.stack ?? '');
        }
    });
}

/**
 * Error notices: what they said goes in the list (so it reads like what was seen), and each gets
 * a small 🔍 that opens the list. A tap on the notice itself still just closes it.
 */
function watchNotices() {
    const original = toastr.error;
    toastr.error = function (message, title) {
        add('알림', [title, message].filter(Boolean).join(' · ').replace(/<[^>]*>/g, ' '));
        const notice = original.apply(this, arguments);
        try {
            const element = notice?.[0] ?? notice;
            if (isOn('errorLog') && element instanceof HTMLElement) {
                const button = document.createElement('div');
                button.className = 'stqa_toast_detail fa-solid fa-magnifying-glass';
                button.title = '자세히 보기';
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    showLog().catch(error => console.error(`[${MODULE}] Error log failed`, error));
                });
                element.append(button);
            }
        } catch {
            // The notice shows as usual without the button
        }
        return notice;
    };
}

function asText(list) {
    return list.map(entry => `[${entry.time.toLocaleTimeString()}] ${entry.kind} | ${entry.title}${entry.detail ? `\n${entry.detail}` : ''}`).join('\n\n');
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        (document.querySelector('dialog[open]:last-of-type') ?? document.body).append(area);
        area.select();
        const copied = document.execCommand('copy');
        area.remove();
        return copied;
    }
}

/** The log, newest first, with Copy and Close. */
async function showLog() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const list = [...entries].reverse();
    const content = document.createElement('div');
    content.className = 'stqa_error_log';
    content.innerHTML = '<h3>오류 내용</h3><div class="stqa_hint">최근 오류부터 보입니다. 서버(터묵스) 화면 자체는 볼 수 없지만, 서버가 돌려준 오류 내용은 그대로 담겨 있습니다.</div>';
    if (!list.length) {
        content.insertAdjacentHTML('beforeend', '<div class="stqa_hint">모아 둔 오류가 없습니다.</div>');
    }
    for (const entry of list) {
        const item = document.createElement('div');
        item.className = 'stqa_error_item';
        item.innerHTML = '<div class="stqa_error_head"><b></b><span></span></div><div class="stqa_error_title"></div><pre class="stqa_error_detail"></pre>';
        item.querySelector('b').textContent = entry.kind;
        item.querySelector('span').textContent = entry.time.toLocaleTimeString();
        item.querySelector('.stqa_error_title').textContent = entry.title;
        const detail = item.querySelector('pre');
        entry.detail ? (detail.textContent = entry.detail) : detail.remove();
        content.append(item);
    }
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        cancelButton: false,
        // No result: Copy leaves the window open
        customButtons: list.length ? [{ text: '복사', action: async () => {
            (await copy(asText(list))) ? toastr.success('오류 내용을 복사했습니다.', TITLE) : toastr.error('복사하지 못했습니다.', TITLE);
        } }] : [],
        allowVerticalScrolling: true,
        leftAlign: true,
    });
    await popup.show();
}

export function initErrorLog() {
    try {
        watchRequests();
        watchScripts();
        watchNotices();
    } catch (error) {
        console.warn(`[${MODULE}] Error log is off`, error);
    }
}
