// A reply that came back with nothing at all (an API error, an empty answer): deleted, generated
// again, or both, as chosen, with a notice. Only when there is truly nothing: no text, no
// reasoning, no picture or file. Generated again up to the number of times set (never endlessly,
// for an API that keeps failing).
import { MODULE, getSettings, isOn } from './settings.js';
import { withoutTrash } from './message-trash.js';

const TITLE = '편의성 모음';
// Generations that leave a reply in the chat
const WATCHED = ['normal', 'regenerate', 'swipe'];
// After the generation ends: ST saves and draws the reply first
const SETTLE_MS = 400;
export const MAX_RETRIES = 10;

/** What happens to an empty reply. */
export const EMPTY_REPLY_MODES = Object.freeze([
    { value: 'delete', label: '지우기만' },
    { value: 'retry', label: '다시 생성만' },
    { value: 'both', label: '지우고 다시 생성' },
]);

/** The mode chosen (before there was one: generating again was set by a count above 0). */
export function emptyReplyMode() {
    const settings = getSettings();
    return EMPTY_REPLY_MODES.some(mode => mode.value === settings.emptyReplyMode)
        ? settings.emptyReplyMode
        : (Number(settings.emptyReplyRetries) > 0 ? 'both' : 'delete');
}

/** Whether an empty reply is deleted (not when only generating again). */
export const deletesEmpty = () => emptyReplyMode() !== 'retry';

/** How many times an empty reply is generated again (0: never). */
export function retryLimit() {
    if (emptyReplyMode() === 'delete') {
        return 0;
    }
    const count = Math.floor(Number(getSettings().emptyReplyRetries));
    return Number.isFinite(count) ? Math.min(MAX_RETRIES, Math.max(0, count)) : 0;
}

/**
 * The notice for an empty reply. `again`: what is done again ('다시 생성' / 'QR을 다시 실행');
 * `next`: the try about to start (0: none), `tries`: the tries made before this one.
 */
export function tellEmpty(again, next, tries) {
    const limit = retryLimit();
    const deleted = deletesEmpty();
    if (next) {
        toastr.info(`빈 답변${deleted ? '을 지우고' : '이라'} ${again}합니다. (${next}/${limit})`, TITLE);
    } else if (limit && tries) {
        toastr.warning(`${deleted ? '빈 답변을 지웠습니다. ' : ''}${again.replace(/^QR을 /, '')} ${limit}번도 모두 비어 있었습니다.`, TITLE);
    } else if (deleted) {
        toastr.info('빈 답변을 지웠습니다.', TITLE);
    }
}
// The generation being watched: { type, chatId, last, tokens, stopped, attempt }
let watch = null;
// A retry asked for here: which one, and when (a generation starting soon after is it)
let retrying = null;
const RETRY_START_MS = 3000;
let emptyRun = { count: 0, at: 0 };
const EMPTY_RUN_MS = 60000;

function onStarted(type, _params, dryRun) {
    type ||= 'normal';
    if (dryRun || !WATCHED.includes(type)) {
        return;
    }
    // A new reply on the way: what was waiting for the last one is over
    rendering = 0;
    afterRendering = null;
    const context = SillyTavern.getContext();
    watch = { type, chatId: context.getCurrentChatId(), last: context.chat.at(-1), tokens: false, stopped: false, attempt: retrying && Date.now() - retrying.at < RETRY_START_MS ? retrying.attempt : 0 };
    retrying = null;
}

const isGenerating = () => {
    const stop = document.getElementById('mes_stop');
    return Boolean(stop) && getComputedStyle(stop).display !== 'none';
};

/** Nothing at all in the message: no text, reasoning, picture or file. */
export function hasNothing(message, streamFailed = false) {
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
        emptyRun = { count: 0, at: 0 };
        return;
    }
    // Empty replies in a row (a real reply, or a minute without one, starts it over): a second
    // stop for retries, should one ever not be told apart from a new generation
    emptyRun = { count: Date.now() - emptyRun.at < EMPTY_RUN_MS ? emptyRun.count + 1 : 1, at: Date.now() };
    const swipes = Array.isArray(message.swipes) ? message.swipes.length : 0;
    const limit = retryLimit();
    const next = current.attempt + 1;
    const retry = next <= limit && emptyRun.count <= limit;
    const deleted = deletesEmpty();
    if (deleted) {
        await withoutTrash(() => (swipes > 1
            ? context.deleteMessage(id, message.swipe_id ?? swipes - 1, false)
            : context.deleteMessage(id, undefined, false, false)));
    }
    tellEmpty('다시 생성', retry ? next : 0, current.attempt || emptyRun.count > 1);
    if (!retry) {
        return;
    }
    retrying = { attempt: next, at: Date.now() };
    // Kept (only generating again), or deleted as one swipe of several: a new swipe on the
    // message, as ST's own swipe makes it; a deleted message: a new reply in its place
    if (!deleted || (swipes > 1 && chat.at(-1) === message)) {
        document.querySelector('#chat .last_mes .swipe_right')?.click();
    } else {
        // 'regenerate' leaves what is typed in the input bar alone
        await context.generate('regenerate');
    }
}

function onEnded() {
    const current = watch;
    if (!current) {
        return;
    }
    // A stream that failed before its first word leaves ST's '...' placeholder
    const processor = SillyTavern.getContext().streamingProcessor;
    const streamFailed = Boolean(processor && processor.isStopped && !processor.isFinished && !processor.result && !current.tokens);
    const run = () => {
        // Another generation followed (tool calls, another extension): that one is checked instead
        if (watch !== current || isGenerating()) {
            return;
        }
        watch = null;
        if (isOn('emptyReplyDelete')) {
            check(current, streamFailed).catch(error => console.error(`[${MODULE}] Empty reply check failed`, error));
        }
    };
    setTimeout(() => {
        // Other extensions still handling the reply (translating, summarizing...): after them
        rendering ? (afterRendering = run) : run();
    }, SETTLE_MS);
}

// ST tells extensions about a reply (received, then rendered), waiting for each in turn. The
// reply is deleted only once all of them are done with it, never under one still using it.
let rendering = 0;
let afterRendering = null;

function onReceived() {
    rendering++;
}

function onRendered() {
    rendering = Math.max(0, rendering - 1);
    if (!rendering && afterRendering) {
        const run = afterRendering;
        afterRendering = null;
        // Outside ST's own round of telling extensions, which waits for each
        setTimeout(run, 0);
    }
}

export function initEmptyReply() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.GENERATION_STARTED, (...args) => {
        // First to hear of a reply, last to hear it was drawn (extensions loaded after this one too)
        eventSource.makeFirst(eventTypes.MESSAGE_RECEIVED, onReceived);
        eventSource.makeLast(eventTypes.CHARACTER_MESSAGE_RENDERED, onRendered);
        onStarted(...args);
    });
    eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, () => watch && (watch.tokens = true));
    eventSource.on(eventTypes.GENERATION_STOPPED, () => watch && (watch.stopped = true));
    eventSource.on(eventTypes.GENERATION_ENDED, onEnded);
    eventSource.on(eventTypes.CHAT_CHANGED, () => (watch = null));
}
