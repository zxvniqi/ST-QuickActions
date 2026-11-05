// Prompts, world info and the character description read in Korean, for reading only: what is
// saved and sent stays the original. Translations are kept in the browser (IndexedDB) by
// original text and shown in place of the originals while "번역 보기" is on.
//  - prompt list (between Name and Tokens) / world info toolbar: translate the names or the
//    contents there, switch original ⇄ translation everywhere, delete that list's translations
//  - prompt edit form, each world info entry, the character description: translate that one,
//    switch just it, delete its translations
//  - tapping a translation shows that one's original (to edit it)
// Google (through ST's translator) by default, or an AI connection with a prompt of one's own
// (settings window); one job at a time. Stored translations load only once they are shown.
import { MODULE, getSettings, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const TITLE = '편의성 모음';
const LANG = 'ko';
const DB_NAME = 'stqa_translations';
const STORE = 'texts';
const CHUNK = 3500; // characters per request; long texts go in parts, split at line breaks
const VIEW_CLASS = 'stqa_tr_view';
const HIDDEN_CLASS = 'stqa_tr_hidden';
const LABEL_CLASS = 'stqa_tr_label';

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

export const DEFAULT_TRANSLATE_PROMPT = '다음 글을 자연스러운 한국어로 번역하세요. 줄바꿈, 마크다운, HTML 태그, {{char}} 같은 매크로와 고유명사는 그대로 두고, 설명 없이 번역문만 출력하세요.\n\n{{text}}';

/** One piece through the chosen engine: Google (ST's translator) or an AI connection. */
async function translatePiece(part) {
    const settings = getSettings();
    if (settings.translateEngine !== 'ai') {
        translator ??= await import('../../translate/index.js');
        return translator.translate(part, LANG, 'google');
    }
    const template = settings.translatePrompt?.trim() || DEFAULT_TRANSLATE_PROMPT;
    // The text goes where {{text}} is (other macros are left for the text itself)
    const prompt = template.includes('{{text}}') ? template.split('{{text}}').join(part) : `${template}\n\n${part}`;
    const context = SillyTavern.getContext();
    const maxTokens = Math.min(8000, Math.max(300, part.length * 2));
    if (settings.translateProfile && context.ConnectionManagerRequestService) {
        const result = await context.ConnectionManagerRequestService.sendRequest(settings.translateProfile, [{ role: 'user', content: prompt }], maxTokens, { stream: false, extractData: true, includePreset: false, includeInstruct: false });
        return result?.content;
    }
    return context.generateRaw({ prompt, responseLength: maxTokens });
}

async function translateText(text) {
    if (cache.has(text)) {
        return cache.get(text);
    }
    const parts = [];
    for (const part of chunks(text)) {
        const result = part.trim() ? await translatePiece(part) : part;
        if (typeof result !== 'string' || (part.trim() && !result.trim())) {
            throw new Error('No translation');
        }
        parts.push(result.trim() ? result : part);
    }
    const translation = parts.join('\n');
    await remember(text, translation);
    return translation;
}

// Set by tapping the spinning button: the running job stops before its next text
let stopAsked = false;

/** Translates the texts not translated yet, with a running count; returns how many failed. */
async function translateAll(texts) {
    await loadCache();
    const todo = [...new Set(texts)].filter(text => text?.trim() && !isKorean(text) && !cache.has(text));
    if (!todo.length) {
        toastr.info('새로 번역할 것이 없습니다. 이미 번역했거나 한국어입니다.', TITLE);
        return 0;
    }
    const toast = toastr.info(`번역하는 중… 0/${todo.length} (돌아가는 버튼을 누르면 멈춥니다)`, TITLE, { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
    let failed = 0;
    let done = 0;
    try {
        for (const text of todo) {
            if (stopAsked) {
                break;
            }
            toast.find('.toast-message').text(`번역하는 중… ${done + failed + 1}/${todo.length} (돌아가는 버튼을 누르면 멈춥니다)`);
            try {
                await translateText(text);
                done++;
            } catch (error) {
                console.error(`[${MODULE}] Translating failed`, error);
                failed++;
            }
        }
    } finally {
        toastr.clear(toast);
    }
    if (stopAsked) {
        toastr.info(`멈췄습니다. ${done}개를 번역했습니다.`, TITLE);
    } else if (failed) {
        const hint = getSettings().translateEngine === 'ai' ? 'AI 연결(API)이 되어 있는지 확인합니다.' : '인터넷 연결을 확인하거나 잠시 뒤 다시 합니다.';
        toastr.warning(`${done}개를 번역했고, ${failed}개는 번역하지 못했습니다. ${hint}`, TITLE);
    } else {
        toastr.success(`${done}개를 번역했습니다.`, TITLE);
    }
    return failed;
}
/* ---------- showing ---------- */

const viewOn = () => isOn('entryTranslate') && getSettings().translationView === true;
// One item switched apart from the rest: original text → 'original' | 'translation'
const itemView = new Map();
const showsTranslation = text => (itemView.get(text) ?? (viewOn() ? 'translation' : 'original')) === 'translation';

const PROMPT_FIELDS = ['completion_prompt_manager_popup_entry_form_name', 'completion_prompt_manager_popup_entry_form_prompt'];
const CHARACTER_FIELDS = ['description_textarea'];

/** Text fields and labels that can show a translation, with their original text. */
function targets() {
    const found = [];
    const add = (element, text) => element && found.push({ element, text });
    // Prompt list names
    for (const name of document.querySelectorAll('.completion_prompt_manager_prompt_name > [title]:not(.fa-solid)')) {
        add(name, name.getAttribute('title'));
    }
    // The prompt edit form and the character description
    for (const id of [...PROMPT_FIELDS, ...CHARACTER_FIELDS]) {
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
    if (!cache) {
        return;
    }
    const wanted = new Set();
    for (const { element, text } of targets()) {
        const translation = text && showsTranslation(text) && cache.get(text);
        if (!element.matches('input, textarea')) {
            // A label (prompt list name): its own text is swapped, so the row keeps its layout
            if (translation) {
                element.dataset.stqaOriginal ??= element.textContent;
                element.textContent !== translation && (element.textContent = translation);
                element.classList.add(LABEL_CLASS);
            } else if (element.dataset.stqaOriginal !== undefined) {
                element.textContent = element.dataset.stqaOriginal;
                delete element.dataset.stqaOriginal;
                element.classList.remove(LABEL_CLASS);
            }
            continue;
        }
        let view = element.nextElementSibling?.classList.contains(VIEW_CLASS) ? element.nextElementSibling : null;
        if (!translation) {
            view?.remove();
            element.classList.remove(HIDDEN_CLASS);
            continue;
        }
        if (!view) {
            view = document.createElement('div');
            view.className = `${VIEW_CLASS} text_pole${element.matches('textarea') ? ' stqa_tr_long' : ''}`;
            view.title = '번역문 (누르면 이것만 원문 보기)';
            element.after(view);
        }
        view.dataset.original = text;
        if (view.textContent !== translation) {
            view.textContent = translation;
        }
        element.classList.add(HIDDEN_CLASS);
        wanted.add(view);
    }
    // Views whose field went away or changed
    document.querySelectorAll(`.${VIEW_CLASS}`).forEach((view) => {
        if (!wanted.has(view)) {
            view.previousElementSibling?.classList.remove(HIDDEN_CLASS);
            view.remove();
        }
    });
    syncToggles();
}

async function setView(on) {
    getSettings().translationView = on;
    itemView.clear();
    SillyTavern.getContext().saveSettingsDebounced();
    await loadCache();
    render();
}

/* ---------- what each place holds ---------- */

async function promptTexts() {
    openai ??= await import('../../../openai.js');
    const prompts = openai.promptManager?.serviceSettings?.prompts ?? [];
    return { names: prompts.map(prompt => prompt.name), contents: prompts.map(prompt => prompt.content) };
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
    return entries && { names: Object.values(entries).map(entry => entry.comment), contents: Object.values(entries).map(entry => entry.content) };
}

const fieldTexts = ids => ids.map(id => document.getElementById(id)?.value);

/** What each place holds: { names, contents } (null when there is nothing open). */
const LISTS = {
    prompts: promptTexts,
    world: worldTexts,
    promptForm: async () => {
        const [name, content] = fieldTexts(PROMPT_FIELDS);
        return { names: [name], contents: [content] };
    },
    character: async () => ({ names: [], contents: fieldTexts(CHARACTER_FIELDS) }),
    // One world info entry: the entry the tapped button is in
    wiEntry: async (button) => {
        const item = (await worldEntries())?.[button?.closest('.world_entry')?.getAttribute('uid')];
        return item && { names: [item.comment], contents: [item.content] };
    },
};

const allTexts = texts => [...(texts?.names ?? []), ...(texts?.contents ?? [])];

/* ---------- actions (one at a time) ---------- */

let busy = null;

/**
 * Runs a translating job with its button spinning. Tapping that button again stops it; any
 * other translate button meanwhile only says one is running.
 */
async function job(button, task) {
    if (busy) {
        if (button === busy) {
            stopAsked = true;
            toastr.info('멈추는 중… 지금 번역하는 것까지만 끝냅니다.', TITLE);
        } else {
            toastr.info('이미 번역하는 중입니다. 돌아가는 버튼을 누르면 멈춥니다.', TITLE);
        }
        return;
    }
    busy = button;
    stopAsked = false;
    button?.classList.add('stqa_busy');
    document.body.classList.add('stqa_translating');
    try {
        await task();
    } catch (error) {
        console.error(`[${MODULE}] Translation failed`, error);
        toastr.error('번역하지 못했습니다.', TITLE);
    } finally {
        busy = null;
        stopAsked = false;
        button?.classList.remove('stqa_busy');
        document.body.classList.remove('stqa_translating');
    }
}

/** Names or contents of a list translated, then shown translated. */
async function translatePart(list, part, button) {
    const texts = await LISTS[list](button);
    if (texts) {
        await translateAll(texts[part]);
        await setView(true);
    }
}

/** One item: translated and shown if it isn't yet, otherwise switched between the two. */
async function toggleOne(texts) {
    const present = texts.filter(text => text?.trim());
    if (!present.length) {
        toastr.info('번역할 내용이 없습니다.', TITLE);
        return;
    }
    await loadCache();
    // Only when all of it is shown translated does a tap go back to the original
    const showing = present.every(text => cache.has(text) && showsTranslation(text));
    if (!showing) {
        await translateAll(present);
    }
    present.forEach(text => itemView.set(text, showing ? 'original' : 'translation'));
    render();
}

/** One item (the open prompt): just switched between original and translation. */
async function switchOne(texts) {
    await loadCache();
    const present = texts.filter(text => text?.trim() && cache.has(text));
    if (!present.length) {
        toastr.info('아직 번역하지 않았습니다. 文A를 먼저 누릅니다.', TITLE);
        return;
    }
    const showing = present.every(showsTranslation);
    present.forEach(text => itemView.set(text, showing ? 'original' : 'translation'));
    render();
}

async function deleteList(list, button) {
    const texts = allTexts(await LISTS[list](button));
    await loadCache();
    const kept = [...new Set(texts)].filter(text => text && cache.has(text));
    if (!kept.length) {
        toastr.info('지울 번역이 없습니다.', TITLE);
        return;
    }
    if (!await SillyTavern.getContext().Popup.show.confirm(`번역 ${kept.length}개 삭제`, '저장된 번역을 지웁니다. 원문은 그대로입니다.')) {
        return;
    }
    try {
        const store = (await openDb()).transaction(STORE, 'readwrite').objectStore(STORE);
        kept.forEach(text => store.delete(text));
    } catch {
        // Only this visit kept them
    }
    kept.forEach((text) => {
        cache.delete(text);
        itemView.delete(text);
    });
    render();
    toastr.success(`번역 ${kept.length}개를 지웠습니다.`, TITLE);
}

/* ---------- buttons ---------- */

// [action, icon, title]. 이름 / 내용: a label or a paragraph, with a small 文A in the corner (CSS)
const LIST_BUTTONS = [
    ['names', 'fa-tag stqa_tr_badge', '이름 번역 (보기만 바뀝니다)'],
    ['contents', 'fa-align-left stqa_tr_badge', '내용 번역 (보기만 바뀝니다)'],
    ['toggle', 'fa-repeat', '원문 ⇄ 번역 전환'],
    ['delete', 'fa-eraser', '이 목록의 번역 지우기'],
];
const ONE_BUTTONS = [
    ['one', 'fa-language', '번역 (이름과 내용)'],
    ['switch', 'fa-repeat', '이것만 원문 ⇄ 번역 전환'],
    ['delete', 'fa-eraser', '이것의 번역 지우기'],
];

/**
 * A group of buttons for a place, made to sit among ST's own toolbar buttons. `worded`: built
 * like ST's worded buttons (icon plus an invisible character) to match those beside it.
 */
function buttonGroup(id, list, buttons, worded = false) {
    const group = document.createElement('div');
    if (id) {
        group.id = id;
    }
    group.className = 'stqa_tr_icons';
    for (const [action, look, title] of buttons) {
        const button = document.createElement('div');
        button.className = `menu_button stqa_tr_icon${worded ? ' menu_button_icon' : ` fa-solid ${look}`}${action === 'toggle' ? ' stqa_tr_toggle' : ''}`;
        if (worded) {
            button.innerHTML = `<i class="fa-solid ${look}"></i>&#8203;`;
        }
        button.dataset.trList = list;
        button.dataset.trDo = action;
        button.title = title;
        group.append(button);
    }
    return group;
}

function syncToggles() {
    const on = viewOn();
    document.querySelectorAll('.stqa_tr_toggle').forEach((toggle) => {
        toggle.classList.toggle('stqa_active', on);
        toggle.title = on ? '지금 번역문을 보는 중 (누르면 원문 보기)' : '지금 원문을 보는 중 (누르면 번역 보기)';
    });
    // World info buttons only while a world info is open
    document.body.classList.toggle('stqa_wi_open', Boolean(document.getElementById('world_editor_select')?.value));
}

/** Each world info entry: 文A ⇄ 지우개 in a row above its own ↔ ⧉ 🗑 (three over three). */
function addEntryButtons(entry) {
    const move = entry.querySelector(':scope .move_entry_button');
    if (!move || entry.querySelector('.stqa_wi_grid')) {
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'stqa_wi_grid';
    move.before(grid);
    grid.append(...buttonGroup('', 'wiEntry', ONE_BUTTONS).children);
    // ST's own three move in under them; their handlers stay with them
    for (const own of [move, entry.querySelector('.duplicate_entry_button'), entry.querySelector('.delete_entry_button')]) {
        own && grid.append(own);
    }
}

function addButtons() {
    if (!isOn('entryTranslate')) {
        return;
    }
    // Prompt edit form: in the middle of its bottom row (✕ on the left, ↺ 💾 on the right)
    const close = document.getElementById('completion_prompt_manager_popup_entry_form_close');
    if (close && !document.getElementById('stqa_prompt_form_tr')) {
        close.after(buttonGroup('stqa_prompt_form_tr', 'promptForm', ONE_BUTTONS));
    }
    // Prompt list: in its column titles, in the gap between "Name" and "Tokens"
    const head = document.querySelector('.completion_prompt_manager_list_head');
    if (head?.firstElementChild && !document.getElementById('stqa_prompt_tr')) {
        head.firstElementChild.after(buttonGroup('stqa_prompt_tr', 'prompts', LIST_BUTTONS));
    }
    // World info: at the right end of the ↻ row
    const refreshButton = document.getElementById('world_refresh');
    if (refreshButton && !document.getElementById('stqa_wi_tr')) {
        refreshButton.parentElement.append(buttonGroup('stqa_wi_tr', 'world', LIST_BUTTONS));
    }
    document.querySelectorAll('#world_popup_entries_list .world_entry').forEach(addEntryButtons);
    // Character description: next to its Ext. Media button
    const media = document.getElementById('character_open_media_overrides');
    if (media && !document.getElementById('stqa_description_tr')) {
        media.before(buttonGroup('stqa_description_tr', 'character', ONE_BUTTONS, true));
    }
    syncToggles();
}

function onClick(event) {
    const target = event.target;
    const view = target.closest(`.${VIEW_CLASS}`);
    if (view) {
        // A translation tapped: that one shows its original, to read or edit
        event.stopPropagation();
        itemView.set(view.dataset.original, 'original');
        render();
        return;
    }
    const icon = target.closest('[data-tr-do]');
    if (!icon) {
        return;
    }
    // Not a tap on what the button sits in (a world info entry's header folds it)
    event.stopPropagation();
    const { trList: list, trDo: action } = icon.dataset;
    if (action === 'toggle') {
        setView(!viewOn());
    } else if (action === 'delete') {
        deleteList(list, icon);
    } else if (action === 'switch') {
        LISTS[list](icon).then(texts => switchOne(allTexts(texts)));
    } else if (action === 'one') {
        job(icon, async () => toggleOne(allTexts(await LISTS[list](icon))));
    } else {
        job(icon, () => translatePart(list, action, icon));
    }
}

/** Stored translations are needed only while some are shown. */
const showingAny = () => viewOn() || [...itemView.values()].includes('translation');

export function applyEntryTranslate() {
    document.body.classList.toggle('stqa_entry_translate_on', isOn('entryTranslate'));
    addButtons();
    if (cache || showingAny()) {
        loadCache().then(render);
    }
}

export function initEntryTranslate() {
    let queued = false;
    const refresh = (records) => {
        if (!isOn('entryTranslate') || onlyOwnChanges(records) || queued) {
            return;
        }
        queued = true;
        // A timer, not an animation frame: those wait while the page is in the background
        setTimeout(() => {
            queued = false;
            addButtons();
            cache && render();
        }, 50);
    };
    for (const selector of ['#world_popup_entries_list', '#completion_prompt_manager', '#completion_prompt_manager_popup']) {
        const target = document.querySelector(selector);
        target && new MutationObserver(refresh).observe(target, { childList: true, subtree: true });
    }
    document.addEventListener('click', onClick, true);
    // Forms filled in place (no new elements): look again when they are opened or switched
    const later = () => cache && setTimeout(render, 50);
    document.addEventListener('click', event => event.target.closest?.('.prompt-manager-edit-action, .prompt-manager-inspect-action, .world_entry .inline-drawer-toggle') && later());
    $('#world_editor_select').on('change', syncToggles);
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHARACTER_EDITED ?? 'character_edited', later);
    eventSource.on(eventTypes.CHAT_CHANGED, later);
    applyEntryTranslate();
}