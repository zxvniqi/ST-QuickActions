// A reply that came back with nothing at all (an API error, an empty answer) is deleted, with a
// notice. Only when there is truly nothing: no text, no reasoning, no picture or file. Optionally
// generated once more (once only, so a failing API doesn't go round and round).
import { MODULE, getSettings, isOn } from './settings.js';
import { withoutTrash } from './message-trash.js';

const TITLE = '편의성 모음';
// Generations that leave a reply in the chat
const WATCHED = ['normal', 'regenerate', 'swipe'];
// After the generation ends: ST saves and draws the reply first
const SETTLE_MS = 400;

export const EMPTY_REPLY_MODES = Object.freeze([
    { value: 'delete', label: '지우기만' },
    { value: 'retry', label: '지우고 다시 생성 (1번)' },
]);

// The generation being watched: { type, chatId, last, tokens, stopped, retried }
let watch = null;
// The next generation is the retry made here (not retried again)
let retrying = false;

function onStarted(type, _params, dryRun) {
    type ||= 'normal';
    if (dryRun || !WATCHED.includes(type)) {
        return;
    }
    const context = SillyTavern.getContext();
    watch = { type, chatId: context.getCurrentChatId(), last: context.chat.at(-1), tokens: false, stopped: false, retried: retrying };
    retrying = false;
}

const isGenerating = () => {
    const stop = document.getElementById('mes_stop');
    return Boolean(stop) && getComputedStyle(stop).display !== 'none';
};

function hasNothing(message, streamFailed) {
    const text = String(message.mes ?? '');
    // '...' is what ST shows while waiting for a streamed reply; left there when the stream failed
    const blank = !text.trim() || (text === '...' && streamFailed);
    const extra = message.extra ?? {};
    const attached = ['reasoning', 'image', 'inline_image', 'file', 'files', 'media', 'tool_invocations']
        .some(key => (Array.isArray(extra[key]) ? extra[key].length : String(extra[key] ?? '').trim()));
    return blank && !attached;
}

async function check(current, streamFailed) {
    const context = SillyTavern.getContext();
    const { chat } = context;
    const id = chat.length - 1;
    const message = chat[id];
    if (current.stopped || context.getCurrentChatId() !== current.chatId || !message || message.is_user || message.is_system) {
        return;
    }
    // Only the reply this generation made (a new message, or the new swipe of the same one)
    if (message === current.last && current.type !== 'swipe') {
        return;
    }
    if (!hasNothing(message, streamFailed)) {
        return;
    }
    const swipes = Array.isArray(message.swipes) ? message.swipes.length : 0;
    const retry = getSettings().emptyReplyMode === 'retry' && !current.retried;
    await withoutTrash(() => (swipes > 1
        ? context.deleteMessage(id, message.swipe_id ?? swipes - 1, false)
        : context.deleteMessage(id, undefined, false, false)));
    toastr.info(retry ? '빈 답변을 지우고 다시 생성합니다.' : '빈 답변을 지웠습니다.', TITLE);
    if (!retry) {
        return;
    }
    retrying = true;
    const last = chat.at(-1);
    if (swipes > 1 && last === message) {
        // The swipe before it is shown now: one more swipe to the right makes a new one
        document.querySelector('#chat .last_mes .swipe_right')?.click();
    } else {
        // 'regenerate' leaves what is typed in the input bar alone
        await context.generate('regenerate');
    }
    // The click or call did not start a generation: the flag must not stick to a later one
    setTimeout(() => (retrying = false), 1000);
}

function onEnded() {
    const current = watch;
    if (!current) {
        return;
    }
    // A stream that failed before its first word leaves ST's '...' placeholder
    const processor = SillyTavern.getContext().streamingProcessor;
    const streamFailed = Boolean(processor && processor.isStopped && !processor.isFinished && !processor.result && !current.tokens);
    setTimeout(() => {
        // Another generation followed (tool calls, another extension): that one is checked instead
        if (watch !== current || isGenerating()) {
            return;
        }
        watch = null;
        if (isOn('emptyReplyDelete')) {
            check(current, streamFailed).catch(error => console.error(`[${MODULE}] Empty reply check failed`, error));
        }
    }, SETTLE_MS);
}

export function initEmptyReply() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.GENERATION_STARTED, onStarted);
    eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, () => watch && (watch.tokens = true));
    eventSource.on(eventTypes.GENERATION_STOPPED, () => watch && (watch.stopped = true));
    eventSource.on(eventTypes.GENERATION_ENDED, onEnded);
    eventSource.on(eventTypes.CHAT_CHANGED, () => (watch = null));
}
