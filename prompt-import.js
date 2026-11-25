// Prompt items from another prompt (preset):
//  - 가져오기 (the button by ✚ under the prompt list): tick items of another prompt and pick where
//    they go in this one; they come in as copies, each keeping its on / off.
//  - 교체 (the ··· menu of an item): the item takes another prompt's item's name, role, text
//    and placement; its own place in the list and its on / off stay. Undone from the notice.
import { MODULE } from './settings.js';
import { knownTranslations, translationsShown } from './entry-translate.js';
import { escapeHtml } from './util.js';

const TITLE = '편의성 모음';
const GLOBAL_ORDER = 100001;

let openai = null;
try {
    openai = await import('../../../openai.js');
} catch (error) {
    console.warn(`[${MODULE}] Prompt manager not available; prompt import is off`, error);
}

const manager = () => openai?.promptManager ?? null;
const currentName = () => openai?.oai_settings?.preset_settings_openai ?? '';
const searchable = text => String(text ?? '').toLowerCase().replace(/\s+/g, '');
const ROLE_ICONS = { user: 'fa-user', assistant: 'fa-robot' };

function currentOrder() {
    const pm = manager();
    return pm?.activeCharacter ? pm.getPromptOrderForCharacter(pm.activeCharacter) : [];
}

/** Names of the saved prompts (presets), this one first. */
function presetNames() {
    const names = Object.keys(openai?.openai_setting_names ?? {});
    const current = currentName();
    return [current, ...names.filter(name => name !== current)].filter(name => names.includes(name));
}

/**
 * A prompt's items in its list's order: { prompt, enabled }. This prompt's come from the manager
 * (changes not saved yet included); another's from its saved copy. Markers (chat history and the
 * like) have no text of their own, so they are left out.
 */
function itemsOf(name) {
    const pm = manager();
    let prompts;
    let orders;
    if (name === currentName()) {
        prompts = pm.serviceSettings.prompts ?? [];
        orders = pm.serviceSettings.prompt_order ?? [];
    } else {
        const preset = openai.openai_settings?.[openai.openai_setting_names?.[name]];
        prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
        orders = Array.isArray(preset?.prompt_order) ? preset.prompt_order : [];
    }
    const ordered = orders.find(entry => entry.character_id === pm.activeCharacter?.id)
        ?? orders.find(entry => entry.character_id === GLOBAL_ORDER) ?? orders[0];
    const byId = new Map(prompts.map(prompt => [prompt.identifier, prompt]));
    const list = Array.isArray(ordered?.order)
        ? ordered.order.map(entry => ({ prompt: byId.get(entry.identifier), enabled: entry.enabled !== false }))
        : prompts.map(prompt => ({ prompt, enabled: prompt.enabled !== false }));
    return list.filter(item => item.prompt && !item.prompt.marker);
}

const firstLine = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * The window's picking part: the prompt to take from, a search box, and its items (ticked, or
 * one chosen). Returns the element and a getter of the chosen items.
 */
function buildPicker({ multiple, exclude = null, onChange }) {
    const box = document.createElement('div');
    box.className = 'stqa_pimport_pick';
    box.innerHTML = `
        <label class="stqa_pimport_field"><span>가져올 프롬프트</span><select class="text_pole"></select></label>
        <div class="stqa_panel_search"><i class="fa-solid fa-magnifying-glass"></i><input class="text_pole" type="search" placeholder="항목 찾기"></div>
        <div class="stqa_pimport_list"></div>`;
    // 가져오기 brings each item's on / off along: the dot says which (교체 leaves it as it is: no dots)
    if (multiple) {
        box.querySelector('.stqa_pimport_list').insertAdjacentHTML('beforebegin', '<div class="stqa_pimport_legend"><span class="stqa_pimport_state stqa_on"></span>켜진 항목 (켜진 채로 들어옵니다)</div>');
    } else {
        box.classList.add('stqa_pimport_no_state');
    }
    const select = box.querySelector('select');
    const search = box.querySelector('input');
    const list = box.querySelector('.stqa_pimport_list');
    const current = currentName();
    for (const name of presetNames()) {
        select.append(new Option(name === current ? `${name} (지금)` : name, name));
    }
    // Another prompt first: taking from this very one is a copy within it
    select.value = presetNames().find(name => name !== current) ?? current;
    const ownNames = new Set(itemsOf(current).map(item => searchable(item.prompt.name)));
    let items = [];
    // Names translated before (文A): found by either; shown translated while the list shows translations
    let translated = new Map();
    const chosen = new Set();

    const draw = () => {
        const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean).map(searchable);
        list.replaceChildren();
        const shown = items.filter(item => words.every(word => searchable(`${item.prompt.name} ${translated.get(item.prompt.name) ?? ''} ${item.prompt.content}`).includes(word)));
        for (const item of shown) {
            const row = document.createElement('label');
            row.className = 'stqa_pimport_row';
            row.innerHTML = `<input type="${multiple ? 'checkbox' : 'radio'}" name="stqa_pimport"><span class="stqa_pimport_state"></span><span class="stqa_pimport_text"><b></b><small></small></span>`;
            const input = row.querySelector('input');
            input.checked = chosen.has(item);
            row.classList.toggle('stqa_pimport_chosen', input.checked);
            row.querySelector('.stqa_pimport_state').classList.toggle('stqa_on', item.enabled);
            row.querySelector('.stqa_pimport_state').title = item.enabled ? '켜짐' : '꺼짐';
            const name = row.querySelector('b');
            const role = ROLE_ICONS[item.prompt.role];
            role && name.insertAdjacentHTML('afterbegin', `<i class="fa-solid ${role}"></i> `);
            const original = item.prompt.name || '(이름 없음)';
            const translation = translated.get(item.prompt.name);
            name.append(translation && translationsShown() ? translation : original);
            name.title = translation ? `${original} / ${translation}` : original;
            if (ownNames.has(searchable(item.prompt.name)) && select.value !== current) {
                name.insertAdjacentHTML('beforeend', ' <span class="stqa_pimport_same">같은 이름 있음</span>');
            }
            row.querySelector('small').textContent = firstLine(item.prompt.content) || '(내용 없음)';
            input.addEventListener('change', () => {
                if (!multiple) {
                    chosen.clear();
                    list.querySelectorAll('.stqa_pimport_chosen').forEach(other => other.classList.remove('stqa_pimport_chosen'));
                }
                input.checked ? chosen.add(item) : chosen.delete(item);
                row.classList.toggle('stqa_pimport_chosen', input.checked);
                onChange?.([...chosen]);
            });
            list.append(row);
        }
        if (!shown.length) {
            list.innerHTML = `<div class="stqa_pimport_none">${items.length ? '찾은 항목이 없습니다.' : '가져올 항목이 없습니다.'}</div>`;
        }
    };
    const load = async () => {
        const from = select.value;
        items = itemsOf(from).filter(item => item.prompt.identifier !== exclude || from !== current);
        chosen.clear();
        onChange?.([]);
        draw();
        list.scrollTop = 0;
        try {
            translated = await knownTranslations(items.map(item => item.prompt.name).filter(Boolean));
        } catch {
            translated = new Map();
        }
        // (Another prompt picked meanwhile: that one draws itself)
        if (select.value === from && translated.size) {
            draw();
        }
    };
    select.addEventListener('change', load);
    search.addEventListener('input', draw);
    load();
    return { box, picked: () => [...chosen], from: () => select.value };
}

// Items just brought in: marked ("가져옴") for a few seconds (the list is drawn anew often, so each drawing
// marks them again, as far into the fading as they are)
const FRESH_MS = 5000;
let fresh = { ids: [], at: 0 };

export function markFresh() {
    const elapsed = Date.now() - fresh.at;
    if (elapsed >= FRESH_MS) {
        return;
    }
    for (const id of fresh.ids) {
        const row = document.querySelector(`#completion_prompt_manager_list li[data-pm-identifier="${CSS.escape(id)}"]`);
        if (!row || row.classList.contains('stqa_prompt_fresh')) {
            continue;
        }
        row.classList.add('stqa_prompt_fresh');
        row.style.setProperty('--stqa-fresh-delay', `${-elapsed}ms`);
        const name = row.querySelector('.completion_prompt_manager_prompt_name');
        if (name) {
            const tag = document.createElement('span');
            tag.className = 'stqa_fresh_tag';
            tag.textContent = '가져옴';
            name.append(tag);
        }
    }
}

/** The OK button of the window that is open, to say how many it will take. */
const okOf = content => content.closest('.popup')?.querySelector('.popup-button-ok');

async function saveAndDraw(changed = []) {
    const pm = manager();
    // (Token counts of changed items are counted anew, as ST does for its own changes)
    const counts = pm.tokenHandler?.getCounts?.();
    counts && changed.forEach(identifier => (counts[identifier] = null));
    pm.render();
    await pm.saveServiceSettings();
}

/** The prompt changed while the window was open: nothing is done to the other one. */
function samePrompt(name) {
    if (currentName() === name) {
        return true;
    }
    toastr.warning('그사이 프롬프트가 바뀌어 하지 않았습니다.', TITLE);
    return false;
}

/** 가져오기: ticked items of another prompt, copied into this one where chosen. */
export async function openImport() {
    const pm = manager();
    if (!pm?.activeCharacter) {
        return;
    }
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const preset = currentName();
    const content = document.createElement('div');
    content.className = 'stqa_pimport';
    content.innerHTML = '<h3>다른 프롬프트에서 가져오기</h3>';
    const picker = buildPicker({
        multiple: true,
        onChange: (picked) => {
            const ok = okOf(content);
            if (ok) {
                ok.textContent = picked.length ? `${picked.length}개 가져오기` : '가져오기';
                ok.classList.toggle('disabled', !picked.length);
            }
        },
    });
    // Where they go: this prompt's list as it looks, the item to put them under tapped (or 맨 위);
    // a line shows the spot
    const place = document.createElement('div');
    place.className = 'stqa_pimport_place';
    place.innerHTML = '<div class="stqa_pimport_place_head" role="button" tabindex="0"><span>넣을 위치</span><b></b></div><div class="stqa_pimport_slots" hidden></div>';
    const head = place.querySelector('.stqa_pimport_place_head');
    const slots = place.querySelector('.stqa_pimport_slots');
    const order = currentOrder().filter(entry => pm.getPromptById(entry.identifier));
    let where = order.at(-1)?.identifier ?? 'top';
    const nameOf = id => pm.getPromptById(id)?.name || '(이름 없음)';
    const drawPlace = () => {
        head.querySelector('b').textContent = where === 'top' ? '맨 위' : where === order.at(-1)?.identifier ? '맨 아래' : `${nameOf(where)} 아래`;
        slots.querySelectorAll('.stqa_pimport_slot').forEach(slot => slot.classList.toggle('stqa_pimport_here', slot.dataset.at === where));
    };
    const slot = (at, label, top = false) => {
        const row = document.createElement('div');
        row.className = `stqa_pimport_slot${top ? ' stqa_pimport_slot_top' : ''}`;
        row.dataset.at = at;
        row.textContent = label;
        row.addEventListener('click', () => {
            where = at;
            drawPlace();
        });
        return row;
    };
    slots.append(slot('top', '맨 위', true), ...order.map(entry => slot(entry.identifier, nameOf(entry.identifier))));
    head.addEventListener('click', () => {
        slots.hidden = !slots.hidden;
        head.classList.toggle('stqa_open', !slots.hidden);
        !slots.hidden && slots.querySelector('.stqa_pimport_here')?.scrollIntoView({ block: 'nearest' });
    });
    drawPlace();
    content.append(picker.box, place);

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '가져오기', cancelButton: '취소', leftAlign: true });
    const shown = popup.show();
    okOf(content)?.classList.add('disabled');
    if (await shown !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }
    const picked = picker.picked();
    if (!picked.length || !samePrompt(preset)) {
        return;
    }
    const entries = picked.map(({ prompt, enabled }) => {
        const copy = structuredClone(prompt);
        copy.identifier = pm.getUuidv4();
        // A copy of ST's own prompt (Main Prompt...) is an ordinary prompt here
        copy.system_prompt = false;
        copy.marker = false;
        copy.enabled = enabled;
        pm.serviceSettings.prompts.push(copy);
        return { identifier: copy.identifier, enabled };
    });
    // (The list asked about may have changed meanwhile: placed against it as it is now)
    const now = currentOrder();
    const below = now.findIndex(entry => entry.identifier === where);
    const at = where === 'top' ? 0 : below !== -1 ? below + 1 : now.length;
    now.splice(at, 0, ...entries);
    await saveAndDraw(entries.map(entry => entry.identifier));
    fresh = { ids: entries.map(entry => entry.identifier), at: Date.now() };
    markFresh();
    document.querySelector('.stqa_prompt_fresh')?.scrollIntoView({ block: 'nearest' });
    toastr.success(`${entries.length}개를 가져왔습니다.`, TITLE);
}

/** 교체: this item takes another item's name, role, text and placement (its place and on / off stay). */
export async function openReplace(identifier) {
    const pm = manager();
    const target = pm?.getPromptById(identifier);
    if (!target || target.marker) {
        return;
    }
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const preset = currentName();
    const content = document.createElement('div');
    content.className = 'stqa_pimport';
    content.innerHTML = '<h3></h3>';
    content.querySelector('h3').textContent = `'${target.name ?? ''}' 교체`;
    const picker = buildPicker({
        multiple: false,
        exclude: identifier,
        onChange: (picked) => {
            okOf(content)?.classList.toggle('disabled', !picked.length);
        },
    });
    content.append(picker.box);
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton: '교체', cancelButton: '취소', leftAlign: true });
    const shown = popup.show();
    okOf(content)?.classList.add('disabled');
    if (await shown !== POPUP_RESULT.AFFIRMATIVE) {
        return;
    }
    const [source] = picker.picked();
    if (!source || !samePrompt(preset) || pm.getPromptById(identifier) !== target) {
        return;
    }
    const before = structuredClone(target);
    const keep = { identifier: target.identifier, system_prompt: target.system_prompt, marker: target.marker, enabled: target.enabled };
    // The same object, filled anew: the list and every order keep pointing at it
    for (const key of Object.keys(target)) {
        delete target[key];
    }
    Object.assign(target, structuredClone(source.prompt), keep);
    await saveAndDraw([identifier]);
    // Undone once, and only while the item is as the replacement left it (a later edit stays)
    const after = JSON.stringify(target);
    let undone = false;
    const notice = toastr.success('되돌리려면 이 알림을 누르세요.', `'${escapeHtml(before.name)}' 교체함`, {
        timeOut: 10000,
        onclick: async () => {
            if (undone) {
                return;
            }
            undone = true;
            if (currentName() !== preset || pm.getPromptById(identifier) !== target || JSON.stringify(target) !== after) {
                toastr.warning('그사이 바뀌어 되돌리지 않았습니다.', TITLE);
                return;
            }
            for (const key of Object.keys(target)) {
                delete target[key];
            }
            Object.assign(target, before);
            try {
                await saveAndDraw([identifier]);
                toastr.info('되돌렸습니다.', TITLE);
            } catch (error) {
                console.error(`[${MODULE}] Undoing the replacement failed`, error);
                toastr.error('되돌리지 못했습니다.', TITLE);
            }
        },
    });
    return notice;
}
