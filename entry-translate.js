// Prompts and world info read in Korean, for reading only: what is saved and sent stays the
// original. Translations are kept in the browser (IndexedDB) by original text, and shown in
// place of the original names / contents while "번역 보기" is on; tapping a translation goes
// back to the original (to edit it).
//  - 전체 번역 (under the prompt list, in the world info toolbar): every name and content there
//  - 원문 / 번역: switches between the two everywhere
//  - 文A on a prompt's edit form and on each world info entry: just that one
// ST's own translator (its provider setting) does the translating.
import { MODULE, getSettings, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const TITLE = '편의성 모음';
const LANG = 'ko';
const DB_NAME = 'stqa_translations';
const STORE = 'texts';
const CHUNK = 3500; // characters per request; long texts go in parts, split at line breaks
const VIEW_CLASS = 'stqa_tr_view';
const HIDDEN_CLASS = 'stqa_tr_hidden';

let translator = null;
let openai = null;
let worldInfo = null;
// original → translation
let cache = null;
let db = null;

/* ---------- storage ---------- */

function openDb() {
    db ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return db;
}

async function loadCache() {
    if (cache) {
        return cache;
    }
    cache = new Map();
    try {
        const store = (await openDb()).transaction(STORE).objectStore(STORE);
        await new Promise((resolve) => {
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
                const at = cursor.result;
                if (!at) {
                    return resolve();
                }
                cache.set(at.key, at.value);
                at.continue();
            };
            cursor.onerror = () => resolve();
        });
    } catch (error) {
        console.warn(`[${MODULE}] Translations not kept (no IndexedDB)`, error);
    }
    return cache;
}

async function remember(original, translation) {
    cache.set(original, translation);
    try {
        (await openDb()).transaction(STORE, 'readwrite').objectStore(STORE).put(translation, original);
    } catch {
        // Kept for this visit only
    }
}

/* ---------- translating ---------- */

/** Mostly Korean already: nothing to translate. */
const isKorean = text => (text.match(/[가-힣]/g)?.length ?? 0) > (text.match(/\p{L}/gu)?.length ?? 1) * 0.3;

function chunks(text) {
    const parts = [];
    let current = '';
    for (const line of text.split('\n')) {
        if (current && current.length + line.length + 1 > CHUNK) {
            parts.push(current);
            current = '';
        }
        current = current ? `${current}\n${line}` : line;
    }
    parts.push(current);
    return parts;
}

async function translateText(text) {
    if (cache.has(text)) {
        return cache.get(text);
    }
    translator ??= await import('../../translate/index.js');
    const parts = [];
    for (const part of chunks(text)) {
        const result = part.trim() ? await translator.translate(part, LANG) : part;
        if (typeof result !== 'string') {
            throw new Error('No translation');
        }
        parts.push(result);
    }
    const translation = parts.join('\n');
    await remember(text, translation);
    return translation;
}

/** Translates the texts not translated yet, with a running count; returns how many failed. */
async function translateAll(texts) {
    await loadCache();
    const todo = [...new Set(texts)].filter(text => text?.trim() && !isKorean(text) && !cache.has(text));
    if (!todo.length) {
        return 0;
    }
    const toast = toastr.info('', TITLE, { timeOut: 0, extendedTimeOut: 0 });
    let failed = 0;
    try {
        for (const [index, text] of todo.entries()) {
            toast.find('.toast-message').text(`번역하는 중… ${index + 1}/${todo.length}`);
            try {
                await translateText(text);
            } catch (error) {
                console.error(`[${MODULE}] Translating failed`, error);
                failed++;
            }
        }
    } finally {
        toastr.clear(toast);
    }
    if (failed) {
        toastr.warning(`${failed}개를 번역하지 못했습니다. 확장 설정의 번역(Chat Translation) 설정을 확인합니다.`, TITLE);
    }
    return failed;
}

/* ---------- showing ---------- */

const viewOn = () => isOn('entryTranslate') && getSettings().translationView === true;

/** Text fields and labels that can show a translation, with their original text. */
function targets() {
    const found = [];
    const add = (element, text) => element && found.push({ element, text });
    // Prompt list names and the prompt edit form
    for (const name of document.querySelectorAll('.completion_prompt_manager_prompt_name > [title]:not(.fa-solid)')) {
        add(name, name.getAttribute('title'));
    }
    for (const id of ['completion_prompt_manager_popup_entry_form_name', 'completion_prompt_manager_popup_entry_form_prompt']) {
        const field = document.getElementById(id);
        add(field, field?.value);
    }
    // World info entries: name, and content while unfolded
    for (const field of document.querySelectorAll('#world_popup_entries_list .world_entry textarea[name="comment"], #world_popup_entries_list .world_entry textarea[name="content"]')) {
        add(field, field.value);
    }
    return found;
}

function render() {
    const show = viewOn() && cache;
    document.querySelectorAll(`.${VIEW_CLASS}`).forEach((view) => {
        if (!show || !view.previousElementSibling?.classList.contains(HIDDEN_CLASS)) {
            view.previousElementSibling?.classList.remove(HIDDEN_CLASS);
            view.remove();
        }
    });
    if (!show) {
        document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(element => element.classList.remove(HIDDEN_CLASS));
        syncToggles();
        return;
    }
    for (const { element, text } of targets()) {
        const translation = text && cache.get(text);
        let view = element.nextElementSibling?.classList.contains(VIEW_CLASS) ? element.nextElementSibling : null;
        if (!translation) {
            view?.remove();
            element.classList.remove(HIDDEN_CLASS);
            continue;
        }
        if (!view) {
            const isField = element.matches('input, textarea');
            view = document.createElement(isField ? 'div' : 'span');
            view.className = `${VIEW_CLASS}${isField ? ' text_pole' : ''}${element.matches('textarea') ? ' stqa_tr_long' : ''}`;
            view.title = '번역문입니다 (누르면 원문 보기)';
            element.after(view);
        }
        if (view.textContent !== translation) {
            view.textContent = translation;
        }
        element.classList.add(HIDDEN_CLASS);
    }
    syncToggles();
}

async function setView(on) {
    getSettings().translationView = on;
    SillyTavern.getContext().saveSettingsDebounced();
    await loadCache();
    render();
}

/* ---------- actions ---------- */

async function promptTexts() {
    openai ??= await import('../../../openai.js');
    return (openai.promptManager?.serviceSettings?.prompts ?? []).flatMap(prompt => [prompt.name, prompt.content]);
}

/** The entries of the world info open in the editor (saved data, so folded entries count too). */
async function worldEntries() {
    worldInfo ??= await import('../../../world-info.js');
    const select = document.getElementById('world_editor_select');
    const book = select?.value ? select.selectedOptions[0]?.textContent : '';
    if (!book) {
        toastr.info('월드인포를 먼저 엽니다.', TITLE);
        return null;
    }
    return (await worldInfo.loadWorldInfo(book))?.entries ?? {};
}

async function worldTexts() {
    const entries = await worldEntries();
    return entries && Object.values(entries).flatMap(entry => [entry.comment, entry.content]);
}

async function translateList(getTexts) {
    const texts = await getTexts();
    if (texts) {
        await translateAll(texts);
        await setView(true);
    }
}

async function translateOne(texts) {
    await translateAll(texts);
    await setView(true);
}

const run = task => task().catch((error) => {
    console.error(`[${MODULE}] Translation failed`, error);
    toastr.error('번역하지 못했습니다.', TITLE);
});

/* ---------- buttons ---------- */

function toolbar(id) {
    const box = document.createElement('div');
    box.id = id;
    box.className = 'stqa_tr_tools';
    box.innerHTML = `
        <div class="menu_button menu_button_icon" data-do="all" title="이름과 내용을 모두 한국어로 번역해 봅니다 (원문은 그대로)"><i class="fa-solid fa-language"></i><span>전체 번역</span></div>
        <div class="menu_button menu_button_icon stqa_tr_toggle" data-do="toggle" title="원문과 번역문을 바꿔 봅니다"><i class="fa-solid fa-repeat"></i><span></span></div>`;
    return box;
}

function syncToggles() {
    const on = viewOn();
    document.querySelectorAll('.stqa_tr_toggle').forEach((toggle) => {
        toggle.classList.toggle('stqa_active', on);
        toggle.querySelector('span').textContent = on ? '원문 보기' : '번역 보기';
    });
}

function addButtons() {
    if (!isOn('entryTranslate')) {
        return;
    }
    const close = document.getElementById('completion_prompt_manager_popup_entry_form_close');
    if (close && !document.getElementById('stqa_prompt_translate')) {
        const button = document.createElement('i');
        button.id = 'stqa_prompt_translate';
        button.className = 'menu_button fa-solid fa-language stqa_tr_one';
        button.title = '이 프롬프트 번역해 보기';
        close.before(button);
    }
    const footer = document.querySelector('.completion_prompt_manager_footer');
    if (footer && !document.getElementById('stqa_prompt_tr_tools')) {
        footer.after(toolbar('stqa_prompt_tr_tools'));
    }
    const wiTools = document.getElementById('OpenAllWIEntries')?.parentElement;
    if (wiTools && !document.getElementById('stqa_wi_tr_tools')) {
        wiTools.after(toolbar('stqa_wi_tr_tools'));
    }
    for (const entry of document.querySelectorAll('#world_popup_entries_list .world_entry')) {
        const move = entry.querySelector('.move_entry_button');
        if (move && !entry.querySelector('.stqa_wi_translate')) {
            const button = document.createElement('i');
            button.className = 'menu_button fa-solid fa-language stqa_tr_one stqa_wi_translate';
            button.title = '이 항목 번역해 보기';
            move.before(button);
        }
    }
    syncToggles();
}

function onClick(event) {
    const target = event.target;
    if (target.closest(`.${VIEW_CLASS}`)) {
        // A translation tapped: back to the original, to read or edit it
        event.stopPropagation();
        run(() => setView(false));
        return;
    }
    const action = target.closest('.stqa_tr_tools [data-do]')?.dataset.do;
    if (action) {
        const fromPrompts = Boolean(target.closest('#stqa_prompt_tr_tools'));
        run(() => (action === 'toggle' ? setView(!viewOn()) : translateList(fromPrompts ? promptTexts : worldTexts)));
        return;
    }
    const one = target.closest('.stqa_tr_one');
    if (!one) {
        return;
    }
    event.stopPropagation();
    if (one.id === 'stqa_prompt_translate') {
        const texts = ['completion_prompt_manager_popup_entry_form_name', 'completion_prompt_manager_popup_entry_form_prompt'].map(id => document.getElementById(id)?.value);
        run(() => translateOne(texts));
    } else {
        run(async () => {
            const item = (await worldEntries())?.[one.closest('.world_entry')?.getAttribute('uid')];
            item && await translateOne([item.comment, item.content]);
        });
    }
}

export function applyEntryTranslate() {
    document.body.classList.toggle('stqa_entry_translate_on', isOn('entryTranslate'));
    addButtons();
    (viewOn() ? loadCache() : Promise.resolve()).then(render);
}

export function initEntryTranslate() {
    let queued = false;
    const refresh = (records) => {
        if (onlyOwnChanges(records) || queued) {
            return;
        }
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            addButtons();
            viewOn() && render();
        });
    };
    for (const selector of ['#world_popup_entries_list', '#completion_prompt_manager', '#completion_prompt_manager_popup']) {
        const target = document.querySelector(selector);
        target && new MutationObserver(refresh).observe(target, { childList: true, subtree: true });
    }
    // The edit form is filled in place (no new elements): look again when it is opened
    document.addEventListener('click', onClick, true);
    document.addEventListener('click', event => event.target.closest?.('.prompt-manager-edit-action, .prompt-manager-inspect-action, .world_entry .inline-drawer-toggle') && setTimeout(() => viewOn() && render(), 50));
    applyEntryTranslate();
}
