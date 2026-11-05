// Character list: a ★ (favorite) and a tag button on each character, so neither needs the
// character opened. The tag button at the top of the list picks several characters (tap to
// tick) and tags them all at once. Tags are ST's own (same list, same filters).
import { isOn } from './settings.js';
import { addTagsToEntity, removeTagFromEntity, tags, tag_map, TAG_FOLDER_DEFAULT_TYPE } from '../../../tags.js';
import { DEFAULT_FILTER_STATE } from '../../../filters.js';
import { uuidv4 } from '../../../utils.js';
import { printCharactersDebounced } from '../../../../script.js';
import { onlyOwnChanges } from './mutations.js';

const TITLE = '편의성 모음';
const LIST = '#rm_print_characters_block';
const PICK_BUTTON_ID = 'stqa_char_pick';
const BAR_ID = 'stqa_char_pick_bar';

// Characters ticked in pick mode, by avatar file (ids shift when the list changes)
const picked = new Set();
let picking = false;

const characterOf = row => SillyTavern.getContext().characters[Number(row.getAttribute('data-chid'))];

function isFav(character) {
    return character.fav === true || character.fav === 'true';
}

async function toggleFav(character) {
    const fav = !isFav(character);
    const response = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({ avatar: character.avatar, fav, data: { extensions: { fav } } }),
    });
    if (!response.ok) {
        toastr.error('즐겨찾기를 바꾸지 못했습니다.', TITLE);
        return;
    }
    character.fav = fav;
    character.data ??= {};
    character.data.extensions ??= {};
    character.data.extensions.fav = fav;
    // The open character's own ★ button follows too
    if (SillyTavern.getContext().characters[SillyTavern.getContext().characterId] === character) {
        $('#favorite_button').toggleClass('fav_on', fav).toggleClass('fav_off', !fav);
        $('#fav_checkbox').prop('checked', fav);
    }
    printCharactersDebounced();
}

/** Tags for the characters (avatar files): tap a tag to give it to all of them, tap again to take it away. */
async function openTagPopup(avatars) {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const content = document.createElement('div');
    content.className = 'stqa_tag_popup';

    const has = (tag, avatar) => (tag_map[avatar] ?? []).includes(tag.id);
    const render = () => {
        const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
        content.innerHTML = `
            <h3></h3>
            <div class="stqa_hint">태그를 누르면 넣고, 다시 누르면 뺍니다. 일부만 가진 태그는 점선으로 표시되며, 누르면 모두에게 넣습니다.</div>
            <div class="stqa_tag_new"><input class="text_pole" type="text" maxlength="25" placeholder="새 태그 이름"><div class="menu_button"><i class="fa-solid fa-plus"></i><span>만들어 넣기</span></div></div>
            <div class="stqa_tag_chips"></div>`;
        content.querySelector('h3').textContent = avatars.length > 1 ? `태그 · ${avatars.length}명` : `태그 · ${SillyTavern.getContext().characters.find(c => c.avatar === avatars[0])?.name ?? ''}`;
        const chips = content.querySelector('.stqa_tag_chips');
        if (!sorted.length) {
            chips.innerHTML = '<div class="stqa_hint">태그가 없습니다. 위에서 새로 만듭니다.</div>';
        }
        for (const tag of sorted) {
            const count = avatars.filter(avatar => has(tag, avatar)).length;
            const chip = document.createElement('div');
            chip.className = `stqa_tag_chip${count === avatars.length ? ' stqa_active' : count ? ' stqa_partial' : ''}`;
            chip.textContent = tag.name;
            if (tag.color) {
                chip.style.setProperty('--stqa_tag_color', tag.color);
            }
            chip.addEventListener('click', () => {
                count === avatars.length ? removeTagFromEntity(tag, avatars) : addTagsToEntity(tag, avatars);
                render();
            });
            chips.append(chip);
        }
        const input = content.querySelector('.stqa_tag_new input');
        const create = () => {
            const name = input.value.trim();
            if (!name) {
                return;
            }
            let tag = tags.find(item => item.name.toLowerCase() === name.toLowerCase());
            if (!tag) {
                // The same fields ST gives a new tag
                tag = {
                    id: uuidv4(),
                    name,
                    folder_type: TAG_FOLDER_DEFAULT_TYPE,
                    filter_state: DEFAULT_FILTER_STATE,
                    sort_order: Math.max(0, ...tags.map(item => item.sort_order ?? 0)) + 1,
                    is_hidden_on_character_card: false,
                    color: '',
                    color2: '',
                    create_date: Date.now(),
                };
                tags.push(tag);
            }
            addTagsToEntity(tag, avatars);
            render();
        };
        content.querySelector('.stqa_tag_new .menu_button').addEventListener('click', create);
        input.addEventListener('keydown', event => event.key === 'Enter' && create());
    };
    render();
    await new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true }).show();
}

function decorate(row) {
    const character = characterOf(row);
    if (!character) {
        return;
    }
    let tools = row.querySelector('.stqa_char_tools');
    if (!tools) {
        tools = document.createElement('div');
        tools.className = 'stqa_char_tools';
        tools.innerHTML = '<div class="stqa_char_tool" data-tool="fav" title="즐겨찾기"></div><div class="stqa_char_tool fa-solid fa-tag" data-tool="tag" title="태그"></div>';
        // Where the card's tags were; the tags go under it, smaller (CSS)
        const tags = row.querySelector('.tags');
        tags ? tags.before(tools) : row.append(tools);
    }
    const fav = isFav(character);
    tools.querySelector('[data-tool="fav"]').className = `stqa_char_tool ${fav ? 'fa-solid stqa_on' : 'fa-regular'} fa-star`;
    row.classList.toggle('stqa_char_picked', picked.has(character.avatar));
}

function decorateAll() {
    if (!isOn('charListTools')) {
        return;
    }
    document.querySelectorAll(`${LIST} .character_select[data-chid]`).forEach(decorate);
}

function syncBar() {
    let bar = document.getElementById(BAR_ID);
    if (!picking) {
        bar?.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.innerHTML = `
            <span class="stqa_char_pick_count"></span>
            <div class="menu_button" data-do="tag"><i class="fa-solid fa-tags"></i><span>태그</span></div>
            <div class="menu_button" data-do="fav"><i class="fa-solid fa-star"></i><span>즐겨찾기</span></div>
            <div class="menu_button" data-do="done"><span>끝내기</span></div>`;
        bar.addEventListener('click', async (event) => {
            const action = event.target.closest('[data-do]')?.dataset.do;
            const avatars = [...picked];
            if (action === 'done') {
                setPicking(false);
            } else if (!avatars.length) {
                action && toastr.info('캐릭터를 먼저 누릅니다.', TITLE);
            } else if (action === 'tag') {
                await openTagPopup(avatars);
            } else if (action === 'fav') {
                // All favorites already: take them off; otherwise make all favorites
                const chosen = SillyTavern.getContext().characters.filter(character => picked.has(character.avatar));
                const allFav = chosen.every(isFav);
                for (const character of chosen.filter(character => isFav(character) === allFav)) {
                    await toggleFav(character);
                }
            }
        });
        document.body.append(bar);
    }
    bar.querySelector('.stqa_char_pick_count').textContent = `${picked.size}명 선택`;
}

function setPicking(on) {
    picking = on;
    picked.clear();
    document.body.classList.toggle('stqa_char_picking', on);
    document.getElementById(PICK_BUTTON_ID)?.classList.toggle('stqa_active', on);
    syncBar();
    decorateAll();
}

/** Taps on the list: the ★ / tag buttons, and in pick mode a tap ticks instead of opening. */
function onListClick(event) {
    if (!isOn('charListTools')) {
        return;
    }
    const row = event.target.closest('.character_select[data-chid]');
    const character = row && characterOf(row);
    if (!character) {
        return;
    }
    const tool = event.target.closest('.stqa_char_tool')?.dataset.tool;
    if (!tool && !picking) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (tool === 'fav') {
        toggleFav(character);
    } else if (tool === 'tag') {
        openTagPopup([character.avatar]);
    } else {
        picked.has(character.avatar) ? picked.delete(character.avatar) : picked.add(character.avatar);
        decorate(row);
        syncBar();
    }
}

function addPickButton() {
    const anchor = document.getElementById('bulkEditButton');
    if (!anchor || document.getElementById(PICK_BUTTON_ID)) {
        return;
    }
    const button = document.createElement('i');
    button.id = PICK_BUTTON_ID;
    button.className = 'fa-solid fa-tags menu_button';
    button.title = '여러 캐릭터 골라서 태그·즐겨찾기';
    button.addEventListener('click', () => setPicking(!picking));
    anchor.after(button);
}

export function applyCharListTools() {
    const on = isOn('charListTools');
    document.body.classList.toggle('stqa_char_tools_on', on);
    if (!on && picking) {
        setPicking(false);
    }
    decorateAll();
}

export function initCharListTools() {
    addPickButton();
    // Capture: runs before ST's own handler that opens the character
    document.getElementById('rm_print_characters_block')?.addEventListener('click', onListClick, true);
    // ST redraws the list (pages, filters, search): new rows get the buttons
    const list = document.querySelector(LIST);
    if (list) {
        new MutationObserver(records => !onlyOwnChanges(records) && decorateAll()).observe(list, { childList: true, subtree: true });
    }
    applyCharListTools();
}
