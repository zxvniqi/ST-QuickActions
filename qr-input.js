// Quick Reply helpers:
//  - the input popups a QR opens (/input) get 지우기 / 복사 / 기록 buttons beside OK / Cancel
//  - a message a QR made (/gen + /sendas and the like) can be swiped like a reply: swiping right
//    on its last version runs the QR again with the same answers, and the new text becomes the
//    message's next swipe instead of a new message
//  - a QR whose AI answer came back empty: what it posted is taken back out and the QR runs
//    again with the same answers, as many times as set for empty replies
import { MODULE, getSettings, isOn } from './settings.js';
import { withoutTrash } from './message-trash.js';
import { hasNothing, retryLimit, deletesEmpty, tellEmpty } from './empty-reply.js';
import { animation_duration } from '../../../../script.js';

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

// ST's generation requests (any: a QR's, a translator's...) and how many are not answered yet
const GENERATE_URL = /\/api\/(backends\/[\w-]+\/generate|novelai\/generate|horde\/generate)/;
let pending = 0;
let counter = null;

/**
 * Counts the generation requests under way by sitting on top of fetch (see answersIn). Put back
 * on top before each run, should another extension have put its own fetch over it since.
 */
function countRequests() {
    if (window.fetch === counter) {
        return;
    }
    const fetchBefore = window.fetch;
    counter = window.fetch = async function (...args) {
        if (!GENERATE_URL.test(String(args[0]?.url ?? args[0] ?? ''))) {
            return fetchBefore.apply(this, args);
        }
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
        return response;
    };
}
/**
 * What /gen (and /genraw) hand on to the rest of the QR ({{pipe}}): empty means the AI gave
 * nothing usable, also when all it wrote was reasoning, which ST strips off.
 */
function watchGenResults() {
    const commands = SillyTavern.getContext().SlashCommandParser?.commands ?? {};
    for (const name of ['gen', 'genraw']) {
        const command = commands[name];
        if (!command || typeof command.callback !== 'function' || command.stqaWatched) {
            continue;
        }
        const callback = command.callback;
        command.callback = async function (...args) {
            const current = run;
            const result = await callback.apply(this, args);
            if (current && typeof result === 'string' && !result.trim()) {
                current.emptyAnswer = true;
                // What the run posts from here on is not told to other extensions (a translator
                // would start on an empty message about to go): see quietRunEvents
                if (isOn('emptyReplyDelete') && deletesEmpty()) {
                    current.quietFrom ??= SillyTavern.getContext().chat.length;
                }
            }
            return result;
        };
        command.stqaWatched = true;
    }
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

/**
 * A run's own messages taken back out (those very messages, from the last: never one the user
 * added meanwhile); never the user's to keep. False: another chat opened.
 */
async function takeBack(messages, settle = true) {
    const context = SillyTavern.getContext();
    if (!messages.length) {
        return true;
    }
    const chatId = context.getCurrentChatId();
    // (Not needed when no extension was told of the messages: see quietRunEvents)
    settle && await answersIn();
    // Another chat opened meanwhile: nothing there is the run's
    if (context.getCurrentChatId() !== chatId) {
        return false;
    }
    await withoutTrash(async () => {
        for (const message of [...messages].reverse()) {
            const index = context.chat.indexOf(message);
            index >= 0 && await context.deleteMessage(index, undefined, false, false);
        }
    });
    refreshQrMessage();
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
 * After a run started by the user: an empty AI answer is handled as set for empty replies (the
 * run's messages taken back out, the QR run again, or both) and asks for one more run (true)
 * while tries are left; otherwise the made message is marked.
 */
async function afterRun(started, chatId, finished, attempt) {
    const context = SillyTavern.getContext();
    if (context.getCurrentChatId() !== chatId) {
        return false;
    }
    const added = context.chat.slice(started);
    // Stopped by the user: what the run posted stays as it is (no empty-answer handling)
    if (!finished.stopped && isOn('emptyReplyDelete') && added.length && cameEmpty(finished, added)) {
        // Extensions told of none of them (all posted after the empty /gen): taken out at once;
        // otherwise once their requests are answered
        const told = added.some(message => !(context.chat.indexOf(message) >= (finished.quietFrom ?? Infinity)));
        if (deletesEmpty() && !await takeBack(added, told)) {
            return false;
        }
        const again = attempt < retryLimit();
        tellEmpty('QR을 다시 실행', again ? attempt + 1 : 0, attempt);
        return again;
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

/* ---------- looking like ST's own swipe ---------- */

/**
 * ST's swipe motion on one message: its block and avatar slide from xStart to xEnd (ST's own
 * 'slide' animation and speed setting).
 */
async function slide(messageId, xStart, xEnd) {
    const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    const duration = Number(animation_duration) || 0;
    const parts = element ? [...element.querySelectorAll(':scope > .mes_block, :scope > .mesAvatarWrapper')] : [];
    if (!parts.length || duration <= 50) {
        return;
    }
    const root = document.documentElement.style;
    root.setProperty('--slide-mes-x-start', xStart);
    root.setProperty('--slide-mes-x-end', xEnd);
    root.setProperty('--slide-mes-x-duration', `${duration}ms`);
    parts.forEach(part => part.classList.remove('slide'));
    void parts[0].offsetWidth;
    parts.forEach(part => part.classList.add('slide'));
    const animation = parts[0].getAnimations().find(item => item.animationName === 'slide');
    await Promise.race([animation?.finished, sleep(duration * 2)].filter(Boolean)).catch(() => null);
    parts.forEach(part => part.classList.remove('slide'));
    root.setProperty('--slide-mes-x-start', '');
    root.setProperty('--slide-mes-x-end', '');
}

const widthOf = messageId => document.querySelector(`#chat .mes[mesid="${messageId}"]`)?.offsetWidth ?? 0;

/** "2/3" on the message (ST's counter and the ‹ › one). */
function showCount(messageId, message) {
    const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    const text = `${(message.swipe_id ?? 0) + 1}/${message.swipes?.length ?? 1}`;
    element?.querySelectorAll('.swipes-counter, .stqa_footer_count').forEach(counter => (counter.textContent = text));
}

/** The message turned to another version as ST's swipe does: out one side, in from the other. */
async function swapWithMotion(messageId, forward, change) {
    const context = SillyTavern.getContext();
    const width = widthOf(messageId);
    await slide(messageId, '0px', `${forward ? -width : width}px`);
    change();
    context.updateMessageBlock(messageId, context.chat[messageId]);
    showCount(messageId, context.chat[messageId]);
    await slide(messageId, `${forward ? width : -width}px`, '0px');
}

// While a QR message is made again, the messages its run posts stay out of sight: from this index on
let hiddenFrom = null;

/**
 * While a QR message is made again, extensions aren't told of the messages its run posts (a
 * translator would start on them, and they are gone a moment later): they hear of the result,
 * as a new swipe of the message, instead.
 */
function quietRunEvents() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    const quiet = new Set([eventTypes.MESSAGE_RECEIVED, eventTypes.MESSAGE_SENT, eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED].filter(Boolean));
    const emit = eventSource.emit;
    eventSource.emit = function (event, ...args) {
        // From hiddenFrom (a QR message being made again) or run.quietFrom (after an empty /gen)
        const from = hiddenFrom ?? run?.quietFrom ?? null;
        if (from !== null && quiet.has(event) && Number(args[0]) >= from) {
            return Promise.resolve();
        }
        return emit.call(this, event, ...args);
    };
}

function hideRunMessages() {
    if (hiddenFrom === null) {
        return;
    }
    document.querySelectorAll('#chat > .mes[mesid]').forEach((element) => {
        Number(element.getAttribute('mesid')) >= hiddenFrom && element.classList.add('stqa_qr_temp');
    });
}

/* ---------- swiping a QR message ---------- */

/** Shows another of the message's versions (for messages ST doesn't swipe), with ST's motion. */
async function showSwipe(messageId, to) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    ensureSwipes(message);
    const from = message.swipe_id ?? 0;
    if (to < 0 || to >= message.swipes.length || to === from) {
        return;
    }
    const mark = message.extra?.stqa_qr;
    await swapWithMotion(messageId, to > from, () => {
        // What was shown keeps any change made to it (ST does the same when swiping)
        message.swipes[from] = message.mes;
        message.swipe_info[from] = { ...message.swipe_info[from], extra: structuredClone(message.extra ?? {}) };
        const info = message.swipe_info[to] ?? {};
        message.swipe_id = to;
        message.mes = message.swipes[to];
        info.send_date && (message.send_date = info.send_date);
        message.extra = { ...structuredClone(info.extra ?? message.extra ?? {}), stqa_qr: mark };
    });
    await context.saveChat();
    await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, messageId);
}

/** Shows version `to` again after a try that came to nothing (the try's own "..." version goes). */
async function backTo(messageId, to) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    const mark = message.extra?.stqa_qr;
    await swapWithMotion(messageId, false, () => {
        message.swipes.pop();
        message.swipe_info.pop();
        const info = message.swipe_info[to] ?? {};
        message.swipe_id = to;
        message.mes = message.swipes[to];
        info.send_date && (message.send_date = info.send_date);
        message.extra = { ...structuredClone(info.extra ?? {}), stqa_qr: mark };
    });
}

/** A new last version of the message, "..." until the QR has made it. */
function addPlaceholder(message, mark) {
    const extra = { ...structuredClone(message.extra ?? {}), stqa_qr: mark };
    ['display_text', 'original_text_for_translation', 'reasoning', 'reasoning_duration', 'reasoning_signature', 'token_count'].forEach(key => delete extra[key]);
    message.swipes.push('...');
    message.swipe_info.push({ send_date: message.send_date, extra: structuredClone(extra) });
    message.swipe_id = message.swipes.length - 1;
    message.mes = '...';
    message.extra = extra;
}

/** The message's last version filled with what a run made (nothing: left empty). */
function fillLast(message, made, mark) {
    const last = message.swipes.length - 1;
    const extra = { ...structuredClone(made?.extra ?? {}), stqa_qr: mark };
    const text = made?.mes ?? '';
    message.swipes[last] = text;
    message.swipe_info[last] = { send_date: made?.send_date ?? message.send_date, gen_started: made?.gen_started, gen_finished: made?.gen_finished, extra: structuredClone(extra) };
    message.swipe_id = last;
    message.mes = text;
    made?.send_date && (message.send_date = made.send_date);
    message.extra = extra;
}

/**
 * Makes a QR message again, looking like ST's own swipe: the message slides to a new version
 * showing "..." while the QR runs again with the same answers (out of sight: what it posts is
 * taken back out), then the made text fills that version. An empty AI answer is handled as set
 * for empty replies: tried again (deleted, or kept as a version of its own) as many times as set;
 * when it ends with nothing (deleted), the message slides back to the version before.
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
    ensureSwipes(message);
    const previous = message.swipe_id ?? 0;
    // What is shown keeps any change made to it
    message.swipes[previous] = message.mes;
    message.swipe_info[previous] = { ...message.swipe_info[previous], extra: structuredClone(message.extra ?? {}) };
    let made = null;
    // Only generating again, and every try empty: the last empty version stays
    let keptEmpty = false;
    // The "..." version was added (an error before that leaves the message as it was)
    let placed = false;
    let crashed = false;
    // Set until the end whatever happens (left set, every QR run after would go unhandled)
    regenerating = true;
    try {
        await swapWithMotion(messageId, true, () => {
            addPlaceholder(message, mark);
            placed = true;
        });
        for (let attempt = 0; ; attempt++) {
            const before = context.chat.length;
            hiddenFrom = before;
            replay = mark.answers.map(answer => ({ ...answer }));
            let failed = false;
            try {
                await set.executeWithOptions(qr, {});
            } catch (error) {
                // Stopped, or the API failed (ST tells of that itself)
                console.warn(`[${MODULE}] The QR run ended early`, error);
                failed = true;
            } finally {
                replay = null;
            }
            // Another chat opened meanwhile: nothing is touched
            if (context.getCurrentChatId() !== chatId || context.chat[messageId] !== message) {
                return;
            }
            const added = context.chat.slice(before);
            const candidate = madeMessage(added);
            const empty = !failed && !lastRun?.stopped && isOn('emptyReplyDelete') && (lastRun?.emptyAnswer || (candidate && hasNothing(candidate)));
            // The run's own messages go (their text joins the message as its new version)
            if (!await takeBack(added, false)) {
                return;
            }
            // Stopped by the user, or nothing made: back to the version before, quietly
            if (failed || lastRun?.stopped || (!candidate && !empty)) {
                break;
            }
            if (!empty) {
                made = candidate;
                break;
            }
            const again = attempt < limit;
            tellEmpty('QR을 다시 실행', again ? attempt + 1 : 0, attempt);
            if (!deletesEmpty()) {
                // Only generating again: the empty answer stays as a version of its own
                fillLast(message, candidate, mark);
                keptEmpty = !again;
                if (again) {
                    await swapWithMotion(messageId, true, () => addPlaceholder(message, mark));
                }
            }
            if (!again) {
                break;
            }
        }
    } catch (error) {
        console.error(`[${MODULE}] Making the QR message again failed`, error);
        crashed = true;
    } finally {
        hiddenFrom = null;
        regenerating = false;
        // A run's messages still there (an error came between): taken out, never left showing
        const left = [...document.querySelectorAll('#chat .mes.stqa_qr_temp')];
        left.forEach(element => element.classList.remove('stqa_qr_temp'));
        if (crashed && context.getCurrentChatId() === chatId) {
            await takeBack(left.map(element => context.chat[Number(element.getAttribute('mesid'))]).filter(Boolean), false).catch(() => {});
        }
    }
    if (context.getCurrentChatId() !== chatId || context.chat[messageId] !== message || !placed) {
        return;
    }
    if (crashed || (!made && !keptEmpty)) {
        await backTo(messageId, previous);
        return;
    }
    made && fillLast(message, made, mark);
    context.updateMessageBlock(messageId, message);
    showCount(messageId, message);
    await context.saveChat();
    await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, messageId);
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
    // Being made again: wait for it
    if (regenerating) {
        event.preventDefault();
        event.stopImmediatePropagation();
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
 * A finger swipe on the newest QR message. ST turns swipe gestures into taps on its swipe arrows,
 * and only on arrows it shows: none on hidden messages and notes, none while the ‹ › buttons
 * replace them. Then the gesture taps ‹ / › instead.
 */
function onGesture(event) {
    const { powerUserSettings, chat } = SillyTavern.getContext();
    if (!isOn('qrSwipe') || powerUserSettings?.gestures === false || document.querySelector('dialog[open]') || document.getElementById('curEditTextarea')) {
        return;
    }
    const element = event.target?.closest?.('#chat .mes.last_mes');
    if (!element || !chat.at(-1)?.extra?.stqa_qr) {
        return;
    }
    const forward = event.type === 'swiped-left';
    const arrow = [...document.querySelectorAll(forward ? '#chat .swipe_right' : '#chat .swipe_left')].at(-1);
    // ST taps its own arrow (and the tap comes here): nothing more to do
    if (arrow?.offsetParent) {
        return;
    }
    element.querySelector(`.stqa_mes_footer [data-stqa-action="${forward ? 'next' : 'prev'}"]`)?.click();
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
    // ST's "delete the last message" leaves the new last one unmarked as last (the swipe buttons
    // and arrows go with that mark): marked again
    if (isOn('qrSwipe') && element && !element.classList.contains('last_mes')) {
        document.querySelectorAll('#chat .mes.last_mes').forEach(other => other.classList.remove('last_mes'));
        element.classList.add('last_mes');
    }
    element?.classList.toggle('stqa_qr_own', Boolean(message?.extra?.stqa_qr && swipedHere(message)));
    document.body.classList.toggle('stqa_qr_swipe_on', isOn('qrSwipe'));
}

export function initQrInput() {
    // Per-QR history of earlier versions: one shared list now
    delete getSettings().qrInputHistory;
    if (!QuickReplySet) {
        return;
    }
    quietRunEvents();
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
            // Only once one of the features that need them is used (until then fetch and /gen are ST's own)
            if (isOn('qrSwipe') || isOn('emptyReplyDelete')) {
                countRequests();
                watchGenResults();
            }
            run = { set: this, qr, options: { ...options }, answers: [], emptyAnswer: false };
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
    document.addEventListener('swiped-left', onGesture);
    document.addEventListener('swiped-right', onGesture);
    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const event of [eventTypes.CHAT_CHANGED, eventTypes.MESSAGE_SWIPED, eventTypes.MESSAGE_UPDATED]) {
        event && eventSource.on(event, () => setTimeout(refreshQrMessage));
    }
    // The stop button pressed while a QR runs: the run counts as stopped, not as an empty answer,
    // and when a swipe was making it again, the error the cut-off /gen raises isn't shown (a
    // stopped swipe tells nothing either)
    eventSource.on(eventTypes.GENERATION_STOPPED, () => run && (run.stopped = true));
    const showError = toastr.error;
    toastr.error = function (...args) {
        // (An empty toast in its place, so code clearing "its" toast doesn't clear them all)
        // Only for a QR being made again by a swipe (a QR started by its button stays as ST has it)
        return run?.stopped && regenerating && isOn('qrSwipe') ? $() : showError.apply(this, args);
    };
    // Messages added or taken away (any way: replies, /sendas, /comment, deleting): only the
    // chat's own children are watched
    const chat = document.getElementById('chat');
    chat && new MutationObserver(() => {
        hideRunMessages();
        refreshQrMessage();
    }).observe(chat, { childList: true });
    refreshQrMessage();
}
