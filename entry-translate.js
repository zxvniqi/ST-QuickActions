// Prompts, world info and the character description read in Korean, for reading only: what is
// saved and sent stays the original. Translations are kept in the browser (IndexedDB) by
// original text and shown in place of the originals while "번역 보기" is on.
//  - icons in the prompt list footer / world info toolbar: translate all there, switch
//    original ⇄ translation everywhere, delete the translations of that list
//  - 文A on a prompt's edit form, each world info entry and the description: that one only
//    (translates it, or switches just it between original and translation)
//  - tapping a translation shows that one's original (to edit it)
// ST's own translator (its provider setting) does the translating; one job at a time.
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
    const toast = toastr.info(`번역하는 중… 0/${todo.length}`, TITLE, { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
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
    failed
        ? toastr.warning(`${todo.length - failed}개를 번역했고, ${failed}개는 번역하지 못했습니다. 확장 설정의 번역(Chat Translation) 설정을 확인합니다.`, TITLE)
        : toastr.success(`${todo.length}개를 번역했습니다.`, TITLE);
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

const fieldTexts = ids => ids.map(id => document.getElementById(id)?.value);

const LISTS = {
    prompts: promptTexts,
    world: worldTexts,
    character: async () => fieldTexts(CHARACTER_FIELDS),
};

/* ---------- actions (one at a time) ---------- */

let busy = null;

/** Runs a translating job with the button spinning; a second tap meanwhile only says so. */
async function job(button, task) {
    if (busy) {
        toastr.info('이미 번역하는 중입니다. 끝난 뒤 다시 누릅니다.', TITLE);
        return;
    }
    busy = button;
    button?.classList.add('stqa_busy');
    document.body.classList.add('stqa_translating');
    try {
        await task();
    } catch (error) {
        console.error(`[${MODULE}] Translation failed`, error);
        toastr.error('번역하지 못했습니다.', TITLE);
    } finally {
        busy = null;
        button?.classList.remove('stqa_busy');
        document.body.classList.remove('stqa_translating');
    }
}

async function translateList(list) {
    const texts = await LISTS[list]();
    if (texts) {
        await translateAll(texts);
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
    const showing = present.some(text => cache.has(text) && showsTranslation(text));
    if (!showing) {
        await translateAll(present);
    }
    present.forEach(text => itemView.set(text, showing ? 'original' : 'translation'));
    render();
}

async function deleteList(list) {
    const texts = await LISTS[list]();
    await loadCache();
    const kept = [...new Set(texts ?? [])].filter(text => text && cache.has(text));
    if (!kept.length) {
        toastr.info('지울 번역이 없습니다.', TITLE);
        return;
    }
    if (!await SillyTavern.getContext().Popup.show.confirm(`번역 ${kept.length}개 삭제`, '이 목록의 저장된 번역을 지웁니다. 원문은 그대로입니다.')) {
        return;
    }
    try {
        const store = (await openDb()).transaction(STORE, 'readwrite').objectStore(STORE);
        kept.forEach(text => store.delete(text));
    } catch {
        // Only this visit kept them
    }
    kept.forEach(text => cache.delete(text));
    render();
    toastr.success(`번역 ${kept.length}개를 지웠습니다.`, TITLE);
}

/* ---------- buttons ---------- */

/** Icon buttons for a list, made to sit among ST's own toolbar icons. */
function listIcons(list) {
    const icons = [
        ['all', 'fa-language', '전체 번역 (이름과 내용 모두, 보기만 바뀝니다)'],
        ['toggle', 'fa-repeat', '원문 ⇄ 번역 전환'],
        ['delete', 'fa-eraser', '이 목록의 번역 지우기'],
    ];
    return icons.map(([action, icon, title]) => {
        const button = document.createElement('div');
        button.className = `menu_button fa-solid ${icon} stqa_tr_icon${action === 'toggle' ? ' stqa_tr_toggle' : ''}`;
        button.dataset.trList = list;
        button.dataset.trDo = action;
        button.title = title;
        return button;
    });
}

function oneIcon(className, title, fields) {
    const button = document.createElement('i');
    button.className = `menu_button fa-solid fa-language stqa_tr_one ${className}`;
    button.title = title;
    if (fields) {
        button.dataset.trFields = fields.join(' ');
    }
    return button;
}

function syncToggles() {
    const on = viewOn();
    document.querySelectorAll('.stqa_tr_toggle').forEach((toggle) => {
        toggle.classList.toggle('stqa_active', on);
        toggle.title = on ? '지금 번역문을 보는 중 (누르면 원문 보기)' : '지금 원문을 보는 중 (누르면 번역 보기)';
    });
}

function addButtons() {
    if (!isOn('entryTranslate')) {
        return;
    }
    // Prompt edit form: before its ✕
    const close = document.getElementById('completion_prompt_manager_popup_entry_form_close');
    if (close && !document.getElementById('stqa_prompt_translate')) {
        const button = oneIcon('', '이 프롬프트 번역 / 원문 전환', PROMPT_FIELDS);
        button.id = 'stqa_prompt_translate';
        close.before(button);
    }
    // Prompt list: in its header, in the gap between "Prompts" and the token count
    const header = document.querySelector('.completion_prompt_manager_header');
    if (header?.firstElementChild && !header.querySelector('.stqa_tr_icon')) {
        const group = document.createElement('div');
        group.className = 'stqa_tr_icons';
        group.append(...listIcons('prompts'));
        header.firstElementChild.after(group);
    }
    // World info: after its ↻ (the sort list beside it gives up the room; the search box keeps it)
    const refreshButton = document.getElementById('world_refresh');
    if (refreshButton && !refreshButton.parentElement.querySelector('.stqa_tr_icon')) {
        refreshButton.after(...listIcons('world'));
    }
    for (const entry of document.querySelectorAll('#world_popup_entries_list .world_entry')) {
        const move = entry.querySelector('.move_entry_button');
        if (move && !entry.querySelector('.stqa_wi_translate')) {
            move.before(oneIcon('stqa_wi_translate', '이 항목 번역 / 원문 전환'));
        }
    }
    // Character description: next to its Ext. Media button
    const media = document.getElementById('character_open_media_overrides');
    if (media && !document.getElementById('stqa_description_translate')) {
        const button = oneIcon('', '설명 번역 / 원문 전환', CHARACTER_FIELDS);
        button.id = 'stqa_description_translate';
        media.before(button);
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
    if (icon) {
        event.stopPropagation();
        const { trList: list, trDo: action } = icon.dataset;
        if (action === 'toggle') {
            setView(!viewOn());
        } else if (action === 'delete') {
            deleteList(list);
        } else {
            job(icon, () => translateList(list));
        }
        return;
    }
    const one = target.closest('.stqa_tr_one');
    if (!one) {
        return;
    }
    event.stopPropagation();
    if (one.dataset.trFields) {
        job(one, () => toggleOne(fieldTexts(one.dataset.trFields.split(' '))));
    } else {
        job(one, async () => {
            const item = (await worldEntries())?.[one.closest('.world_entry')?.getAttribute('uid')];
            item && await toggleOne([item.comment, item.content]);
        });
    }
}

export function applyEntryTranslate() {
    document.body.classList.toggle('stqa_entry_translate_on', isOn('entryTranslate'));
    addButtons();
    loadCache().then(render);
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
            render();
        });
    };
    for (const selector of ['#world_popup_entries_list', '#completion_prompt_manager', '#completion_prompt_manager_popup']) {
        const target = document.querySelector(selector);
        target && new MutationObserver(refresh).observe(target, { childList: true, subtree: true });
    }
    document.addEventListener('click', onClick, true);
    // Forms filled in place (no new elements): look again when they are opened or switched
    document.addEventListener('click', event => event.target.closest?.('.prompt-manager-edit-action, .prompt-manager-inspect-action, .world_entry .inline-drawer-toggle') && setTimeout(render, 50));
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHARACTER_EDITED ?? 'character_edited', () => setTimeout(render, 50));
    eventSource.on(eventTypes.CHAT_CHANGED, () => setTimeout(render, 50));
    applyEntryTranslate();
}