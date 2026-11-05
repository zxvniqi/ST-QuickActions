// Quick Reply helpers:
//  - the input popups a QR opens (/input) get 지우기 / 복사 / 기록 buttons beside OK / Cancel
//  - a message a QR made (/gen + /sendas and the like) can be swiped like a reply: swiping right
//    on its last version runs the QR again with the same answers, and the new text becomes the
//    message's next swipe instead of a new message
import { MODULE, getSettings, isOn } from './settings.js';

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
                        // The popup sets up its input box right after it is added
                        setTimeout(() => onInputPopup(node));
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

const isGenerating = () => Boolean(document.getElementById('mes_stop')?.offsetParent);

/** After a run started by the user: the last message it added (not the user's) remembers it. */
async function markMadeMessage(started, chatId, finishedRun) {
    const context = SillyTavern.getContext();
    if (!isOn('qrSwipe') || context.getCurrentChatId() !== chatId || context.chat.length <= started) {
        return;
    }
    const made = context.chat.slice(started).reverse().find(message => !message.is_user && !message.is_system);
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
}

/** Whether a swipe right on this message would make a new version (it is on its last one). */
function swipesToNew(message, messageId, chat) {
    const last = Array.isArray(message?.swipes) ? message.swipes.length - 1 : 0;
    return messageId === chat.length - 1 && (message.swipe_id ?? 0) >= last;
}

/**
 * Makes a QR message again: the QR runs with the same answers, the message(s) it adds are taken
 * back out, and the text it made becomes the message's next swipe.
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
    const added = context.chat.slice(before);
    const made = [...added].reverse().find(item => !item.is_user && !item.is_system);
    if (!made) {
        toastr.info('QR이 새 메시지를 만들지 않았습니다.', TITLE);
        return;
    }
    // The run's own messages go (ST's way, one by one from the end), then the text joins as a swipe
    while (context.chat.length > before) {
        await context.deleteLastMessage();
    }
    if (!Array.isArray(message.swipes) || !message.swipes.length) {
        message.swipes = [message.mes];
        message.swipe_info = [{ send_date: message.send_date, gen_started: message.gen_started, gen_finished: message.gen_finished, extra: structuredClone(message.extra ?? {}) }];
        message.swipe_id = 0;
    }
    message.swipe_info ??= message.swipes.map(() => ({}));
    message.swipes.push(made.mes);
    message.swipe_info.push({ send_date: made.send_date, gen_started: made.gen_started, gen_finished: made.gen_finished, extra: { ...structuredClone(made.extra ?? {}), stqa_qr: mark } });
    message.swipe_id = message.swipes.length - 1;
    message.mes = made.mes;
    message.send_date = made.send_date;
    message.extra = { ...structuredClone(made.extra ?? {}), stqa_qr: mark };
    context.updateMessageBlock(messageId, message);
    await context.saveChat();
    await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, messageId);
}

/** A swipe right that would make a new version of a QR message is ours (ST's would write a normal reply). */
function onSwipeClick(event) {
    if (!isOn('qrSwipe')) {
        return;
    }
    const button = event.target.closest('#chat .swipe_right, #chat .stqa_mes_footer [data-stqa-action="next"]');
    const element = button?.closest('.mes');
    if (!element) {
        return;
    }
    const { chat } = SillyTavern.getContext();
    const messageId = Number(element.getAttribute('mesid'));
    const message = chat[messageId];
    if (!message?.extra?.stqa_qr || !swipesToNew(message, messageId, chat)) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    regenerateQrMessage(messageId).catch((error) => {
        console.error(`[${MODULE}] Making the QR message again failed`, error);
        toastr.error('QR 메시지를 다시 만들지 못했습니다.', TITLE);
    });
}
export function initQrInput() {
    // Per-QR history of earlier versions: one shared list now
    delete getSettings().qrInputHistory;
    if (!QuickReplySet) {
        return;
    }
    const execute = QuickReplySet.prototype.executeWithOptions;
    QuickReplySet.prototype.executeWithOptions = async function (qr, options = {}) {
        // Auto-run QRs and QRs started by another QR (/run) belong to the run around them
        if (run || options.isAutoExecute || options.isEditor) {
            return execute.call(this, qr, options);
        }
        run = { set: this, qr, options: { ...options }, answers: [] };
        const context = SillyTavern.getContext();
        const started = context.chat.length;
        const chatId = context.getCurrentChatId();
        watchPopups(true);
        try {
            return await execute.call(this, qr, options);
        } finally {
            const finished = run;
            run = null;
            watchPopups(false);
            !regenerating && markMadeMessage(started, chatId, finished).catch(error => console.error(`[${MODULE}] Marking the QR message failed`, error));
        }
    };
    // Capture: before ST's own swipe (and the 답변 넘기기 button's)
    document.addEventListener('click', onSwipeClick, true);
}
