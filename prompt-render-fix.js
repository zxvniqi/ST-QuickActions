// ST draws the prompt manager by emptying it, waiting for its template, then adding it: two draws
// started together (another extension redrawing while ST does) both empty it and both add, so
// the prompt list shows twice. Draws are made to wait for the one before them. Always on.
import { MODULE } from './settings.js';

export async function initPromptRenderFix() {
    let openai;
    try {
        openai = await import('../../../openai.js');
    } catch (error) {
        console.warn(`[${MODULE}] Prompt manager fix is off`, error);
        return;
    }
    // The prompt manager is made when Chat Completion settings load: wait for it a little
    for (let tries = 0; !openai.promptManager && tries < 20; tries++) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    const prototype = openai.promptManager && Object.getPrototypeOf(openai.promptManager);
    const original = prototype?.renderPromptManager;
    if (typeof original !== 'function' || original.stqaQueued) {
        return;
    }
    let drawing = Promise.resolve();
    const queued = function (...args) {
        const run = drawing.then(() => original.apply(this, args));
        // A draw that never ends doesn't hold the next ones back for long
        drawing = Promise.race([run.catch(() => {}), new Promise(resolve => setTimeout(resolve, 10000))]);
        return run;
    };
    queued.stqaQueued = true;
    prototype.renderPromptManager = queued;
}
