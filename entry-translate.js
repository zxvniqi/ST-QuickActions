// Translating prompts and world info into Korean with ST's own translator (its provider setting):
//  - 文A on a prompt's edit form and on each world info entry: name and content translated,
//    shown first; then put in as the name only or as both (saved the way ST saves edits)
//  - "이름 번역" under the prompt list and in the world info toolbar: every name not in Korean
//    yet is translated in place (names are labels only, never sent to the AI; contents stay).
import { MODULE, isOn } from './settings.js';
import { onlyOwnChanges } from './mutations.js';

const TITLE = '편의성 모음';
const LANG = 'ko';
const HANGUL = /[가-힣]/;
const PROMPT_BUTTON_ID = 'stqa_prompt_translate';
const PROMPT_NAMES_ID = 'stqa_prompt_names_translate';
const WI_NAMES_ID = 'stqa_wi_names_translate';

let translator = null;
let openai = null;
let worldInfo = null;

async function translate(text) {
    if (!text?.trim()) {
        return text ?? '';
    }
    translator ??= await import('../../translate/index.js');
    const result = await translator.translate(text, LANG);
    if (typeof result !== 'string') {
        throw new Error('No translation');
    }
    return result;
}

/** Shows the translation; resolves to 'name', 'all' or null (closed). */
async function showTranslation(name, content) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const toast = toastr.info('번역하는 중…', TITLE, { timeOut: 0, extendedTimeOut: 0 });
    let names;
    let contents;
    try {
        [names, contents] = [await translate(name), await translate(content)];
    } catch (error) {
        console.error(`[${MODULE}] Translating failed`, error);
        toastr.error('번역하지 못했습니다. 확장 설정의 번역(Chat Translation) 설정을 확인합니다.', TITLE);
        return null;
    } finally {
        toastr.clear(toast);
    }
    const view = document.createElement('div');
    view.className = 'stqa_translation';
    view.innerHTML = '<h3>번역</h3><b>이름</b><div class="stqa_translation_text" data-part="name"></div><b>내용</b><div class="stqa_translation_text" data-part="content"></div><div class="stqa_hint">바꾼 내용은 그 항목에 바로 들어갑니다.</div>';
    view.querySelector('[data-part="name"]').textContent = names;
    view.querySelector('[data-part="content"]').textContent = contents || '(내용 없음)';
    // String buttons answer 2, 3... in order
    const answer = await new Popup(view, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        allowVerticalScrolling: true,
        customButtons: ['이름만 바꾸기', '모두 바꾸기'],
    }).show();
    const choice = { 2: 'name', 3: 'all' }[answer];
    return choice ? { choice, name: names, content: contents } : null;
}

/** Puts text in an ST field the way typing would, so ST saves it. */
function setField(field, value) {
    if (field) {
        field.value = value;
        $(field).trigger('input');
    }
}

async function translatePromptForm() {
    const name = document.getElementById('completion_prompt_manager_popup_entry_form_name');
    const content = document.getElementById('completion_prompt_manager_popup_entry_form_prompt');
    const result = await showTranslation(name?.value ?? '', content?.value ?? '');
    if (result) {
        setField(name, result.name);
        result.choice === 'all' && setField(content, result.content);
        toastr.info('저장 버튼을 눌러야 프롬프트에 남습니다.', TITLE);
    }
}

/** The world info open in the editor, with its saved data (a copy). */
async function openWorld() {
    worldInfo ??= await import('../../../world-info.js');
    const select = document.getElementById('world_editor_select');
    const book = select?.value ? select.selectedOptions[0]?.textContent : '';
    return book ? { book, data: await worldInfo.loadWorldInfo(book) } : { book: '', data: null };
}

async function translateWorldEntry(entry) {
    const { book, data } = await openWorld();
    const item = data?.entries?.[entry.getAttribute('uid')];
    if (!item) {
        return;
    }
    const result = await showTranslation(item.comment ?? '', item.content ?? '');
    if (!result) {
        return;
    }
    // The content box is only drawn while the entry is unfolded
    const content = entry.querySelector('textarea[name="content"]');
    if (result.choice === 'all' && !content) {
        item.comment = result.name;
        item.content = result.content;
        await worldInfo.saveWorldInfo(book, data, true);
        worldInfo.reloadEditor(book);
        return;
    }
    setField(entry.querySelector('textarea[name="comment"]'), result.name);
    result.choice === 'all' && setField(content, result.content);
}

/** Translates the names in the list that aren't in Korean; returns how many changed. */
async function translateNames(items, getName, setName) {
    const todo = items.filter(item => getName(item)?.trim() && !HANGUL.test(getName(item)));
    if (!todo.length) {
        toastr.info('번역할 이름이 없습니다. 이미 한국어인 이름은 건너뜁니다.', TITLE);
        return 0;
    }
    const { Popup } = SillyTavern.getContext();
    if (!await Popup.show.confirm(`이름 ${todo.length}개 번역`, '한국어가 아닌 이름을 번역한 이름으로 바꿉니다. 내용은 그대로입니다.')) {
        return 0;
    }
    const toast = toastr.info(`이름 ${todo.length}개 번역하는 중…`, TITLE, { timeOut: 0, extendedTimeOut: 0 });
    let changed = 0;
    try {
        for (const item of todo) {
            try {
                const name = (await translate(getName(item))).trim();
                if (name) {
                    setName(item, name);
                    changed++;
                }
            } catch (error) {
                console.error(`[${MODULE}] Translating a name failed`, error);
            }
        }
    } finally {
        toastr.clear(toast);
    }
    changed < todo.length ? toastr.warning(`${changed}개를 바꿨고, ${todo.length - changed}개는 번역하지 못했습니다.`, TITLE) : toastr.success(`이름 ${changed}개를 바꿨습니다.`, TITLE);
    return changed;
}

async function translatePromptNames() {
    openai ??= await import('../../../openai.js');
    const pm = openai.promptManager;
    const prompts = pm?.serviceSettings?.prompts ?? [];
    // ST's fixed slots (chat history, world info...) keep their names
    const own = prompts.filter(prompt => !prompt.marker && !prompt.system_prompt);
    if (await translateNames(own, prompt => prompt.name, (prompt, name) => (prompt.name = name))) {
        await pm.saveServiceSettings();
        pm.render();
    }
}

async function translateWorldNames() {
    const { book, data } = await openWorld();
    if (!book) {
        toastr.info('월드인포를 먼저 엽니다.', TITLE);
        return;
    }
    const entries = Object.values(data?.entries ?? {});
    if (await translateNames(entries, entry => entry.comment, (entry, name) => (entry.comment = name))) {
        await worldInfo.saveWorldInfo(book, data, true);
        worldInfo.reloadEditor(book);
    }
}

function iconButton(className, title, onClick) {
    const button = document.createElement('i');
    button.className = `menu_button fa-solid fa-language ${className}`;
    button.title = title;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick(event);
    });
    return button;
}

function textButton(id, title, onClick) {
    const button = document.createElement('div');
    button.id = id;
    button.className = 'menu_button menu_button_icon stqa_translate_names';
    button.title = title;
    button.innerHTML = '<i class="fa-solid fa-language"></i><span>이름 번역</span>';
    button.addEventListener('click', () => onClick().catch(error => console.error(`[${MODULE}] Translating names failed`, error)));
    return button;
}

/** Puts the buttons where they belong; ST redraws these places, so this runs again then. */
function addButtons() {
    if (!isOn('entryTranslate')) {
        return;
    }
    const close = document.getElementById('completion_prompt_manager_popup_entry_form_close');
    if (close && !document.getElementById(PROMPT_BUTTON_ID)) {
        const button = iconButton('stqa_prompt_translate', '이름·내용 번역', translatePromptForm);
        button.id = PROMPT_BUTTON_ID;
        close.before(button);
    }
    const footer = document.querySelector('.completion_prompt_manager_footer');
    if (footer && !document.getElementById(PROMPT_NAMES_ID)) {
        footer.append(textButton(PROMPT_NAMES_ID, '한국어가 아닌 프롬프트 이름을 모두 번역', translatePromptNames));
    }
    const wiTools = document.getElementById('OpenAllWIEntries')?.parentElement;
    if (wiTools && !document.getElementById(WI_NAMES_ID)) {
        wiTools.append(textButton(WI_NAMES_ID, '이 월드인포에서 한국어가 아닌 항목 이름을 모두 번역', translateWorldNames));
    }
    for (const entry of document.querySelectorAll('#world_popup_entries_list .world_entry')) {
        const move = entry.querySelector('.move_entry_button');
        if (move && !entry.querySelector('.stqa_wi_translate')) {
            move.before(iconButton('stqa_wi_translate', '이름·내용 번역', () => translateWorldEntry(entry)));
        }
    }
}

export function applyEntryTranslate() {
    const on = isOn('entryTranslate');
    document.body.classList.toggle('stqa_entry_translate_on', on);
    addButtons();
}

export function initEntryTranslate() {
    const watch = (selector) => {
        const target = document.querySelector(selector);
        target && new MutationObserver(records => !onlyOwnChanges(records) && addButtons()).observe(target, { childList: true, subtree: true });
    };
    watch('#world_popup_entries_list');
    watch('#completion_prompt_manager');
    applyEntryTranslate();
}
