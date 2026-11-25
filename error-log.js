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
        return null;
    }
    const entry = { time, kind, title: String(title ?? '').slice(0, 300), detail: String(detail ?? '').slice(0, MAX_TEXT) };
    entries.push(entry);
    // In time order (an answer is read a moment after it arrives)
    entries.sort((a, b) => a.time - b.time);
    entries.splice(0, Math.max(0, entries.length - KEEP));
    return entry;
}

// What belongs to a notice: what went wrong just before it (the failed request it tells of) and
// right after (an answer read a moment late)
const BEFORE_MS = 10000;
const AFTER_MS = 3000;
const aboutNotice = (entry, notice) => entry.time - notice.time <= AFTER_MS && notice.time - entry.time <= BEFORE_MS;

const short = url => String(url ?? '').replace(location.origin, '').split('?')[0];

/** Requests answered with an error: their address, status and answer (read from a copy). */
function watchRequests() {
    const original = window.fetch;
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input?.url;
        const request = original.apply(this, arguments);
        // Off, nothing is copied; asking for the plugin's lines without the plugin is no error
        // (This extension's own files not made yet are no error either)
        if (!isOn('errorLog') || /\/api\/plugins\/stqa-log\/|\/user\/files\/stqa/.test(String(url ?? ''))) {
            return request;
        }
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
        const own = add('알림', [title, message].filter(Boolean).join(' · ').replace(/<[^>]*>/g, ' '));
        const notice = original.apply(this, arguments);
        try {
            const element = notice?.[0] ?? notice;
            if (isOn('errorLog') && element instanceof HTMLElement) {
                const button = document.createElement('div');
                button.className = 'stqa_toast_detail fa-solid fa-magnifying-glass';
                button.title = '자세히 보기';
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    showLog(own).catch(error => console.error(`[${MODULE}] Error log failed`, error));
                });
                element.append(button);
            }
        } catch {
            // The notice shows as usual without the button
        }
        return notice;
    };
}

/**
 * What the server printed lately (the Termux window), when the optional server plugin is in:
 * [{ time, text }], or null without it. A wait of a few seconds at most.
 */
async function serverLines() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const asked = Date.now();
        const response = await fetch('/api/plugins/stqa-log/lines', { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        if (!Array.isArray(data?.lines)) {
            return null;
        }
        // The server's clock may differ from this device's (another device, or just set apart):
        // how far, from the time its answer carries, so its lines are put on this device's time
        const serverNow = Date.parse(response.headers.get('date') ?? '');
        const offset = Number.isFinite(serverNow) ? serverNow - (asked + Date.now()) / 2 : 0;
        return data.lines.map(line => ({ ...line, time: line.time - offset }));
    } catch {
        return null;
    }
}

const SERVER_LINES = 80;
// Around a notice: the server's lines from a little before what it is about to a little after
// (the server's clock is read to the second, hence the extra)
const SERVER_SLACK_MS = 2000;
const serverText = lines => lines.map(line => `[${new Date(line.time).toLocaleTimeString()}] ${line.text}`).join('\n');

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

function itemOf(entry) {
    const item = document.createElement('div');
    item.className = 'stqa_error_item';
    item.innerHTML = '<div class="stqa_error_head"><b></b><span></span></div><div class="stqa_error_title"></div><pre class="stqa_error_detail"></pre>';
    item.querySelector('b').textContent = entry.kind;
    item.querySelector('span').textContent = entry.time.toLocaleTimeString();
    item.querySelector('.stqa_error_title').textContent = entry.title;
    const detail = item.querySelector('pre');
    entry.detail ? (detail.textContent = entry.detail) : detail.remove();
    return item;
}

/**
 * The log, newest first, with Copy and Close. From a notice (`notice`: its entry): what belongs
 * to it, and the earlier ones folded under it; Copy takes what is unfolded.
 */
async function showLog(notice = null) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const list = [...entries].reverse();
    const current = notice && entries.includes(notice) ? list.filter(entry => aboutNotice(entry, notice)) : list;
    const rest = list.filter(entry => !current.includes(entry));
    const server = await serverLines();
    const content = document.createElement('div');
    content.className = 'stqa_error_log';
    content.innerHTML = `<h3>오류 내용</h3><div class="stqa_hint">${server ? '최근 오류부터 보입니다.' : '최근 오류부터 보입니다. 서버 콘솔 화면은 서버 플러그인이 있어야 함께 보입니다.'}</div>`;
    if (!list.length) {
        content.insertAdjacentHTML('beforeend', '<div class="stqa_hint">모아 둔 오류가 없습니다.</div>');
    }
    content.append(...current.map(itemOf));
    let fold = null;
    if (rest.length) {
        fold = document.createElement('details');
        fold.className = 'stqa_error_earlier';
        fold.innerHTML = '<summary></summary>';
        fold.querySelector('summary').textContent = `이전 오류 ${rest.length}개`;
        fold.append(...rest.map(itemOf));
        content.append(fold);
    }
    // The server console's lines (with the plugin). From a notice: only those printed around what
    // it is about, unfolded (none then: the latest ones, folded)
    let serverFold = null;
    let related = [];
    if (notice && server && current.length) {
        const times = current.map(entry => entry.time.getTime());
        const from = Math.min(...times) - BEFORE_MS - SERVER_SLACK_MS;
        const to = Math.max(...times) + AFTER_MS + SERVER_SLACK_MS;
        related = server.filter(line => line.time >= from && line.time <= to).slice(-SERVER_LINES);
    }
    const recent = related.length ? related : server?.slice(-SERVER_LINES) ?? [];
    if (recent.length) {
        serverFold = document.createElement('details');
        serverFold.className = 'stqa_error_earlier stqa_error_server';
        serverFold.open = related.length > 0;
        serverFold.innerHTML = '<summary></summary><pre class="stqa_error_detail"></pre>';
        serverFold.querySelector('summary').textContent = related.length
            ? `서버 화면 (이 오류 무렵 ${related.length}줄)`
            : `서버 화면 (${notice ? '이 오류 무렵 기록 없음 · ' : ''}최근 ${recent.length}줄)`;
        serverFold.querySelector('pre').textContent = serverText(recent);
        content.append(serverFold);
        // The newest lines in sight
        serverFold.addEventListener('toggle', () => {
            const pre = serverFold.querySelector('pre');
            pre.scrollTop = pre.scrollHeight;
        });
    }
    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        cancelButton: false,
        // No result: Copy leaves the window open
        customButtons: list.length || recent.length ? [{ text: '복사', action: async () => {
            const shown = fold?.open ? [...current, ...rest] : current;
            // The server's lines too, when they are unfolded
            const text = [asText(shown), serverFold?.open ? `--- 서버 화면 ---\n${serverText(recent)}` : ''].filter(Boolean).join('\n\n');
            (await copy(text)) ? toastr.success('오류 내용을 복사했습니다.', TITLE) : toastr.error('복사하지 못했습니다.', TITLE);
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
