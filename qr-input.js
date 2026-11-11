// Quick Reply helpers:
//  - the input popups a QR opens (/input) get 지우기 / 복사 / 기록 buttons beside OK / Cancel
//  - a message a QR made (/gen + /sendas and the like) can be swiped like a reply: swiping right
//    on its last version runs the QR again with the same answers, and the new text becomes the
//    message's next swipe instead of a new message
//  - a QR whose AI answer came back empty: what it posted is taken back out and the QR runs
//    again with the same answers, as many times as set for empty replies
import { MODULE, getSettings, isOn } from './settings.js';
import { withoutTrash } from './message-trash.js';
import { hasNothing, retryLimit } from './empty-reply.js';
import { extractMessageFromData } from '../../../../script.js';

const HISTORY_SIZE = 3;
const TITLE = '편의성 모음';
let QuickReplySet = null;
let copyText = null;
try {
    [{ QuickReplySet }, { copyText }] = await Promise.all([
        import('../../quick-reply/src/QuickReplySet.js'),
        import('../../../utils.js'),
    ]);
} catch (error) {
    console.warn(`[${MODULE}] Quick Reply not available; QR input history is off`, error);
}

// The QR running now (outermost one the user started), with the answers given so far
let run = null;

// Answers to type in by themselves while a run is replayed
let replay = null;
let observer = null;

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function remember(value) {
    const settings = getSettings();
    settings.qrRecentInputs = [value, ...settings.qrRecentInputs.filter(item => item !== value)].slice(0, HISTORY_SIZE);
    saveSettings();
}

/**
 * Copies text. The clipboard API can refuse (no permission, page not focused), so the old
 * select-and-copy way is tried then; ST's copyText only falls back when the API is missing.
 */
async function copyToClipboard(text) {
    try {
        await copyText(text);
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

async function copyAndTell(text) {
    if (!text) {
        toastr.info('복사할 내용이 없습니다.', TITLE);
        return;
    }
    const copied = await copyToClipboard(text);
    copied ? toastr.success('복사했습니다.', TITLE) : toastr.error('복사하지 못했습니다.', TITLE);
}

function fill(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

/** The last answers (any QR): tap one to put it in the input box, or copy it. */
function renderHistory(list, input) {
    const recent = getSettings().qrRecentInputs;
    list.replaceChildren();
    if (recent.length === 0) {
        list.innerHTML = '<div class="stqa_hint">기록이 없습니다.</div>';
        return;
    }
    for (const value of recent) {
        const slot = document.createElement('div');
        slot.className = 'stqa_qr_history_slot';
        slot.innerHTML = '<span class="stqa_qr_history_text" title="입력칸에 넣기"></span><i class="fa-solid fa-copy stqa_qr_history_copy" title="복사"></i>';
        slot.querySelector('span').textContent = value;
        slot.querySelector('span').addEventListener('click', () => {
            fill(input, value);
            list.hidden = true;
        });
        slot.querySelector('i').addEventListener('click', () => copyAndTell(value));
        list.append(slot);
    }
}

/**
 * 삭제 / 복사 at the left end of the OK / Cancel row and 기록 at its right end; OK / Cancel stay
 * where ST puts them. Each icon is followed by an invisible character, so the button has a
 * line of text like OK / Cancel and comes out as tall as they are in any theme.
 */
function addTools(input) {
    const left = document.createElement('div');
    left.className = 'stqa_qr_tools stqa_qr_tools_left';
    left.innerHTML = `
        <div class="menu_button stqa_qr_btn" data-tool="clear" title="지금 쓴 내용 지우기"><i class="fa-solid fa-eraser"></i>&#8203;</div>
        <div class="menu_button stqa_qr_btn" data-tool="copy" title="지금 쓴 내용 복사"><i class="fa-solid fa-copy"></i>&#8203;</div>`;
    const right = document.createElement('div');
    right.className = 'stqa_qr_tools stqa_qr_tools_right';
    right.innerHTML = `<div class="menu_button stqa_qr_btn" data-tool="history" title="최근 입력 ${HISTORY_SIZE}개"><i class="fa-solid fa-clock-rotate-left"></i>&#8203;</div>`;
    const list = document.createElement('div');
    list.className = 'stqa_qr_history';
    list.hidden = true;
    const onTool = (event) => {
        const tool = event.target.closest('[data-tool]')?.dataset.tool;
        if (tool === 'clear') {
            fill(input, '');
        } else if (tool === 'copy') {
            copyAndTell(input.value);
        } else if (tool === 'history') {
            list.hidden = !list.hidden;
            if (!list.hidden) {
                renderHistory(list, input);
            }
        }
        right.querySelector('[data-tool="history"]').classList.toggle('stqa_active', !list.hidden);
    };
    left.addEventListener('click', onTool);
    right.addEventListener('click', onTool);
    // At the two ends of the OK / Cancel row (CSS); the history opens right above the row
    const controls = input.closest('dialog')?.querySelector('.popup-controls');
    if (controls) {
        controls.prepend(left);
        controls.append(right);
        controls.before(list);
    } else {
        input.after(left, right, list);
    }
}

/** An input popup opened during a QR run: show the history, record the answer, or answer it by itself when replaying. */
function onInputPopup(dialog) {
    const input = dialog.querySelector('.popup-input');
    if (!run || !input || input.style.display === 'none' || dialog.dataset.stqaQrInput) {
        return;
    }
    const step = run.answers.length;
    const key = `${run.set.name}.${run.qr.label}#${step}`;
    dialog.dataset.stqaQrInput = key;
    run.answers.push(null);
    if (replay?.length) {
        const { value, confirmed } = replay.shift();
        input.value = value;
        run.answers[step] = { value, confirmed };
        dialog.querySelector(confirmed ? '.popup-button-ok' : '.popup-button-cancel')?.click();
        return;
    }
    if (isOn('qrHistory')) {
        addTools(input);
    }
    let cancelled = false;
    dialog.addEventListener('click', (event) => {
        if (event.target.closest('.popup-button-cancel, .popup-button-close')) {
            cancelled = true;
        }
    }, true);
    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            cancelled = true;
        }
    }, true);
    dialog.addEventListener('cancel', () => {
        cancelled = true;
    });
    // The answer is final once the popup starts closing (it's removed after its animation)
    const closing = new MutationObserver(() => {
        if (!dialog.hasAttribute('closing')) {
            return;
        }
        closing.disconnect();
        const value = input.value;
        if (run && run.answers[step] === null) {
            run.answers[step] = { value, confirmed: !cancelled };
        }
        // Only answers sent with OK go to the history (not what was typed and then cancelled)
        if (!cancelled && value.trim()) {
            remember(value);
        }
    });
    closing.observe(dialog, { attributes: true, attributeFilter: ['closing'] });
}

function watchPopups(on) {
    if (on && !observer) {
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLDialogElement && node.classList.contains('popup')) {
                        // At once, before the popup is first painted; if its input box isn't set
                        // up yet (it may be right after being added), once more just after
                        onInputPopup(node);
                        node.dataset.stqaQrInput || setTimeout(() => onInputPopup(node));
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true });
    } else if (!on && observer) {
        observer.disconnect();
        observer = null;
    }
}

// Set while a QR message is being made again: that run marks no message of its own
let regenerating = false;
// The last run that ended (the one being made again reads whether its AI answer was empty)
let lastRun = null;

const isGenerating = () => Boolean(document.getElementById('mes_stop')?.offsetParent);

/* ---------- empty AI answers inside a QR (/gen and the like) ---------- */

// ST's generation requests: their answers are read (a copy) while a QR runs
const GENERATE_URL = /\/api\/(backends\/[\w-]+\/generate|novelai\/generate|horde\/generate)/;

// Generation requests not answered yet (any: a QR's, a translator's...)
let pending = 0;

/** ST's own quiet generation (/gen): its request says so; other extensions' requests don't. */
function isQuietRequest(init) {
    try {
        return typeof init?.body === 'string' && JSON.parse(init.body)?.type === 'quiet';
    } catch {
        return false;
    }
}

let watcher = null;

/**
 * Reads generation answers by sitting on top of fetch. Put back on top before each run, should
 * another extension have put its own fetch over it since.
 */
function watchAnswers() {
    if (window.fetch === watcher) {
        return;
    }
    const fetchBefore = window.fetch;
    watcher = window.fetch = async function (...args) {
        const url = String(args[0]?.url ?? args[0] ?? '');
        if (!GENERATE_URL.test(url)) {
            return fetchBefore.apply(this, args);
        }
        const current = run && isQuietRequest(args[1]) ? run : null;
        pending++;
        let response;
        try {
            response = await fetchBefore.apply(this, args);
        } catch (error) {
            pending--;
            throw error;
        }
        // Answered once its whole body has come in
        response.clone().arrayBuffer().catch(() => null).finally(() => pending--);
        if (current && response.ok && !String(response.headers.get('content-type')).includes('event-stream')) {
            current.reads.push(response.clone().json().then((data) => {
                const text = extractMessageFromData(data);
                if (typeof text === 'string' && !text.trim()) {
                    current.emptyAnswer = true;
                }
            }).catch(() => { /* not JSON: not an answer */ }));
        }
        return response;
    };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits (a minute at most) for the requests under way, so extensions working on the run's
 * messages (an auto translator) are done with them before they are taken out.
 */
async function answersIn() {
    await sleep(300);
    for (const until = Date.now() + 60000; pending > 0 && Date.now() < until;) {
        await sleep(200);
    }
    await sleep(100);
}

/** What a run made came to nothing: its AI answer was empty, or a message it posted has nothing. */
const cameEmpty = (finished, added) => finished.emptyAnswer || added.some(message => !message.is_user && hasNothing(message));

/** A run's own messages taken back out (ST's way, from the end); never the user's to keep. False: another chat opened. */
async function takeBack(before) {
    const context = SillyTavern.getContext();
    if (context.chat.length <= before) {
        return true;
    }
    const chatId = context.getCurrentChatId();
    await answersIn();
    // Another chat opened meanwhile: nothing there is the run's
    if (context.getCurrentChatId() !== chatId) {
        return false;
    }
    await withoutTrash(async () => {
        while (context.chat.length > before) {
            await context.deleteLastMessage();
        }
    });
    return true;
}

/* ---------- the message a run made ---------- */

/**
 * Which of the messages a run added is the one it made: the last that isn't the user's (hidden
 * ones and notes too), else the last of the user's (a QR that writes as {{user}}), unless a
 * reply to it is being generated now (that reply is not the QR's).
 */
function madeMessage(added) {
    const reply = [...added].reverse().find(message => !message.is_user);
    if (reply) {
        return reply;
    }
    return isGenerating() ? null : added.at(-1) ?? null;
}

/** After a run started by the user: the message it made remembers it. */
async function markMadeMessage(started, chatId, finishedRun) {
    const context = SillyTavern.getContext();
    if (!isOn('qrSwipe') || context.getCurrentChatId() !== chatId || context.chat.length <= started) {
        return;
    }
    const made = madeMessage(context.chat.slice(started));
    if (!made) {
        return;
    }
    made.extra ??= {};
    made.extra.stqa_qr = {
        set: finishedRun.set.name,
        qr: finishedRun.qr.label,
        answers: finishedRun.answers.filter(Boolean),
    };
    await context.saveChat();
    refreshQrMessage();
}

/**
 * After a run started by the user: an empty AI answer takes the run's messages back out and asks
 * for one more run (true) while tries are left; otherwise the made message is marked.
 */
async function afterRun(started, chatId, finished, attempt) {
    const context = SillyTavern.getContext();
    if (context.getCurrentChatId() !== chatId) {
        return false;
    }
    // The run's answers read through first
    await Promise.all(finished.reads);
    const added = context.chat.slice(started);
    if (isOn('emptyReplyDelete') && added.length && cameEmpty(finished, added)) {
        const limit = retryLimit();
        if (!await takeBack(started)) {
            return false;
        }
        if (attempt < limit) {
            toastr.info(`빈 답변을 지우고 QR을 다시 실행합니다. (${attempt + 1}/${limit})`, TITLE);
            return true;
        }
        limit ? toastr.warning(`빈 답변을 지웠습니다. 다시 실행 ${limit}번도 모두 비어 있었습니다.`, TITLE) : toastr.info('빈 답변을 지웠습니다.', TITLE);
        return false;
    }
    await markMadeMessage(started, chatId, finished);
    return false;
}

/* ---------- swiping a QR message ---------- */

/** ST swipes only replies that are shown and not small notes: the rest are swiped here. */
const swipedHere = message => Boolean(message.is_user || message.is_system || message.extra?.isSmallSys);

/** Whether a swipe right on this message would make a new version (it is on its last one). */
function swipesToNew(message, messageId, chat) {
    const last = Array.isArray(message?.swipes) ? message.swipes.length - 1 : 0;
    return messageId === chat.length - 1 && (message.swipe_id ?? 0) >= last;
}

function ensureSwipes(message) {
    if (!Array.isArray(message.swipes) || !message.swipes.length) {
        message.swipes = [message.mes];
        message.swipe_info = [{ send_date: message.send_date, gen_started: message.gen_started, gen_finished: message.gen_finished, extra: structuredClone(message.extra ?? {}) }];
        message.swipe_id = 0;
    }
    message.swipe_info ??= message.swipes.map(() => ({}));
}

/** Shows another of the message's versions (for messages ST doesn't swipe). */
async function showSwipe(messageId, to) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    ensureSwipes(message);
    if (to < 0 || to >= message.swipes.length || to === message.swipe_id) {
        return;
    }
    const mark = message.extra?.stqa_qr;
    // What was shown keeps any change made to it (ST does the same when swiping)
    message.swipes[message.swipe_id ?? 0] = message.mes;
    message.swipe_info[message.swipe_id ?? 0] = { ...message.swipe_info[message.swipe_id ?? 0], extra: structuredClone(message.extra ?? {}) };
    const info = message.swipe_info[to] ?? {};
    message.swipe_id = to;
    message.mes = message.swipes[to];
    info.send_date && (message.send_date = info.send_date);
    message.extra = { ...structuredClone(info.extra ?? message.extra ?? {}), stqa_qr: mark };
    context.updateMessageBlock(messageId, message);
    await context.saveChat();
    await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, messageId);
}

/**
 * Makes a QR message again: the QR runs with the same answers, the message(s) it adds are taken
 * back out, and the message it made becomes the message's next swipe. An empty AI answer is
 * tried again, as many times as set for empty replies.
 */
async function regenerateQrMessage(messageId) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    const mark = message?.extra?.stqa_qr;
    const set = QuickReplySet?.list.find(item => item.name === mark?.set);
    const qr = set?.qrList.find(item => item.label === mark?.qr);
    if (!qr) {
        toastr.warning(`이 메시지를 만든 QR(${mark?.set ?? '?'} / ${mark?.qr ?? '?'})을 찾지 못했습니다.`, TITLE);
        return;
    }
    if (isGenerating() || regenerating) {
        return;
    }
    const chatId = context.getCurrentChatId();
    const limit = isOn('emptyReplyDelete') ? retryLimit() : 0;
    for (let attempt = 0; ; attempt++) {
        const before = context.chat.length;
        regenerating = true;
        replay = mark.answers.map(answer => ({ ...answer }));
        try {
            await set.executeWithOptions(qr, {});
        } finally {
            replay = null;
            regenerating = false;
        }
        // Another chat opened meanwhile: nothing is touched
        if (context.getCurrentChatId() !== chatId || context.chat[messageId] !== message) {
            return;
        }
        await Promise.all(lastRun?.reads ?? []);
        const added = context.chat.slice(before);
        const made = madeMessage(added);
        const empty = isOn('emptyReplyDelete') && (lastRun?.emptyAnswer || (made && hasNothing(made)));
        if (!made && !empty) {
            toastr.info('QR이 새 메시지를 만들지 않았습니다.', TITLE);
            return;
        }
        // The run's own messages go, then the text joins as a swipe
        if (!await takeBack(before)) {
            return;
        }
        if (empty) {
            if (attempt < limit) {
                toastr.info(`빈 답변을 지우고 QR을 다시 실행합니다. (${attempt + 1}/${limit})`, TITLE);
                continue;
            }
            limit ? toastr.warning(`빈 답변을 지웠습니다. 다시 실행 ${limit}번도 모두 비어 있었습니다.`, TITLE) : toastr.info('빈 답변을 지웠습니다.', TITLE);
            return;
        }
        ensureSwipes(message);
        message.swipes.push(made.mes);
        message.swipe_info.push({ send_date: made.send_date, gen_started: made.gen_started, gen_finished: made.gen_finished, extra: { ...structuredClone(made.extra ?? {}), stqa_qr: mark } });
        message.swipe_id = message.swipes.length - 1;
        message.mes = made.mes;
        message.send_date = made.send_date;
        message.extra = { ...structuredClone(made.extra ?? {}), stqa_qr: mark };
        context.updateMessageBlock(messageId, message);
        await context.saveChat();
        await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, messageId);
        return;
    }
}

/**
 * A swipe on a QR message: on its last version a swipe right runs the QR again (ST's would write
 * a normal reply); messages ST doesn't swipe (hidden, notes, the user's) are swiped here.
 */
function onSwipeClick(event) {
    if (!isOn('qrSwipe')) {
        return;
    }
    const button = event.target.closest('#chat .swipe_right, #chat .swipe_left, #chat .stqa_mes_footer [data-stqa-action="next"], #chat .stqa_mes_footer [data-stqa-action="prev"]');
    const element = button?.closest('.mes');
    if (!element) {
        return;
    }
    const { chat } = SillyTavern.getContext();
    const messageId = Number(element.getAttribute('mesid'));
    const message = chat[messageId];
    if (!message?.extra?.stqa_qr) {
        return;
    }
    const forward = button.matches('.swipe_right, [data-stqa-action="next"]');
    const anew = forward && swipesToNew(message, messageId, chat);
    if (!anew && !swipedHere(message)) {
        // An earlier version of a reply ST swipes: ST's own swipe
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const task = anew ? regenerateQrMessage(messageId) : showSwipe(messageId, (message.swipe_id ?? 0) + (forward ? 1 : -1));
    task.catch((error) => {
        console.error(`[${MODULE}] Swiping the QR message failed`, error);
        toastr.error('QR 메시지를 넘기지 못했습니다.', TITLE);
    });
}

/**
 * The last message, when a QR made it and ST doesn't swipe it, gets the ‹ 1/2 › buttons (CSS) so
 * it can be swiped and made again.
 */
export function refreshQrMessage() {
    const { chat } = SillyTavern.getContext();
    const id = chat.length - 1;
    const message = chat[id];
    document.querySelectorAll('#chat .mes.stqa_qr_own').forEach(element => element.getAttribute('mesid') !== String(id) && element.classList.remove('stqa_qr_own'));
    const element = document.querySelector(`#chat .mes[mesid="${id}"]`);
    element?.classList.toggle('stqa_qr_own', Boolean(message?.extra?.stqa_qr && swipedHere(message)));
    document.body.classList.toggle('stqa_qr_swipe_on', isOn('qrSwipe'));
}

export function initQrInput() {
    // Per-QR history of earlier versions: one shared list now
    delete getSettings().qrInputHistory;
    if (!QuickReplySet) {
        return;
    }
    watchAnswers();
    const execute = QuickReplySet.prototype.executeWithOptions;
    QuickReplySet.prototype.executeWithOptions = async function (qr, options = {}) {
        // Auto-run QRs and QRs started by another QR (/run) belong to the run around them
        if (run || options.isAutoExecute || options.isEditor) {
            return execute.call(this, qr, options);
        }
        const context = SillyTavern.getContext();
        const chatId = context.getCurrentChatId();
        // Again with the same answers while its AI answer comes back empty (see afterRun)
        for (let attempt = 0, answers = null; ; attempt++) {
            watchAnswers();
            run = { set: this, qr, options: { ...options }, answers: [], emptyAnswer: false, reads: [] };
            const started = context.chat.length;
            const replaying = Boolean(answers);
            if (replaying) {
                replay = answers.map(answer => ({ ...answer }));
            }
            watchPopups(true);
            let result;
            try {
                result = await execute.call(this, qr, options);
            } finally {
                lastRun = run;
                run = null;
                replaying && (replay = null);
                watchPopups(false);
            }
            const finished = lastRun;
            if (regenerating) {
                return result;
            }
            let again = false;
            try {
                again = await afterRun(started, chatId, finished, attempt);
            } catch (error) {
                console.error(`[${MODULE}] After the QR run`, error);
            }
            if (!again) {
                return result;
            }
            answers = finished.answers.filter(Boolean);
        }
    };
    // Capture: before ST's own swipe (and the 답변 넘기기 button's)
    document.addEventListener('click', onSwipeClick, true);
    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const event of [eventTypes.CHAT_CHANGED, eventTypes.MESSAGE_SWIPED, eventTypes.MESSAGE_UPDATED]) {
        event && eventSource.on(event, () => setTimeout(refreshQrMessage));
    }
    // Messages added or taken away (any way: replies, /sendas, /comment, deleting): only the
    // chat's own children are watched
    const chat = document.getElementById('chat');
    chat && new MutationObserver(refreshQrMessage).observe(chat, { childList: true });
    refreshQrMessage();
}
