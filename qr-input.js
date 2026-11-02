// Quick Reply input helpers: the input popups a QR opens (/input) show what was typed there the
// last few times (tap to fill in, or copy), and the last QR can be run again with the same
// answers, e.g. when the AI failed to reply.
import { MODULE, getSettings } from './settings.js';

const HISTORY_SIZE = 3;
// QRs and their input steps remembered at most (oldest dropped)
const HISTORY_KEYS = 40;
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
// The last finished run, for running it again
let lastRun = null;
// Answers to type in by themselves while a run is replayed
let replay = null;
let observer = null;

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function remember(key, value) {
    const settings = getSettings();
    const history = settings.qrInputHistory;
    const list = [value, ...(history[key] ?? []).filter(item => item !== value)].slice(0, HISTORY_SIZE);
    delete history[key];
    history[key] = list;
    for (const old of Object.keys(history).slice(0, -HISTORY_KEYS)) {
        delete history[old];
    }
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

/** The history row under a popup's input box: past answers (tap to fill in) with a copy button each. */
function buildHistory(input, key) {
    const list = getSettings().qrInputHistory[key] ?? [];
    if (list.length === 0) {
        return null;
    }
    const row = document.createElement('div');
    row.className = 'stqa_qr_history';
    row.innerHTML = '<small>최근 입력</small>';
    for (const value of list) {
        const slot = document.createElement('div');
        slot.className = 'stqa_qr_history_slot';
        const text = document.createElement('span');
        text.className = 'stqa_qr_history_text';
        text.textContent = value;
        text.title = '눌러서 입력칸에 넣기';
        const copy = document.createElement('i');
        copy.className = 'fa-solid fa-copy stqa_qr_history_copy';
        copy.title = '복사';
        slot.append(text, copy);
        row.append(slot);
        text.addEventListener('click', () => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        });
        copy.addEventListener('click', async () => {
            const copied = await copyToClipboard(value);
            copied ? toastr.success('복사했어요.', TITLE) : toastr.error('복사하지 못했어요.', TITLE);
        });
    }
    return row;
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
    const history = buildHistory(input, key);
    if (history) {
        input.after(history);
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
        if (value.trim()) {
            remember(key, value);
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

/** Runs the last QR again; its input popups get the same answers by themselves. */
export async function rerunLastQr() {
    if (!lastRun) {
        toastr.info('다시 실행할 QR이 없어요. QR을 한 번 눌러주세요.', TITLE);
        return;
    }
    replay = lastRun.answers.filter(Boolean).map(answer => ({ ...answer }));
    try {
        await lastRun.set.executeWithOptions(lastRun.qr, { ...lastRun.options });
    } finally {
        replay = null;
    }
}

export function hasLastQr() {
    return Boolean(lastRun);
}

export function initQrInput() {
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
        watchPopups(true);
        try {
            return await execute.call(this, qr, options);
        } finally {
            lastRun = run;
            run = null;
            watchPopups(false);
        }
    };
}
