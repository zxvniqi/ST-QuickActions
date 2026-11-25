// ST draws the prompt manager by emptying it, waiting for its template, then adding it: two draws
// started together (another extension redrawing while ST does) both empty it and both add, so
// the prompt list shows twice. Draws are made to wait for the one before them. Always on (while
// the extension is).
import { MODULE, getSettings } from './settings.js';

export async function initPromptRenderFix() {
    let PromptManager;
    try {
        ({ PromptManager } = await import('../../../PromptManager.js'));
    } catch (error) {
        console.warn(`[${MODULE}] Prompt manager fix is off`, error);
        return;
    }
    // The class itself: no waiting for ST to make its prompt manager (a slow start took longer
    // than any wait, and the fix was then never put in)
    const prototype = PromptManager?.prototype;
    const original = prototype?.renderPromptManager;
    if (typeof original !== 'function' || original.stqaQueued) {
        return;
    }
    let drawing = Promise.resolve();
    const queued = function (...args) {
        // The whole extension switched off: ST's own
        if (getSettings().enabled === false) {
            return original.apply(this, args);
        }
        const run = drawing.then(() => original.apply(this, args));
        // A draw that never ends doesn't hold the next ones back for long
        let timer = null;
        drawing = Promise.race([run.catch(() => {}), new Promise((resolve) => {
            timer = setTimeout(resolve, 10000);
        })]).finally(() => clearTimeout(timer));
        return run;
    };
    queued.stqaQueued = true;
    prototype.renderPromptManager = queued;
}
