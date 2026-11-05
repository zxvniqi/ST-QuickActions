// Character list: a ★ (favorite) and a tag button on each character, so neither needs the
// character opened. Tags are ST's own (same list, same filters).
import { isOn } from './settings.js';
import { addTagsToEntity, removeTagFromEntity, tags, tag_map, TAG_FOLDER_DEFAULT_TYPE } from '../../../tags.js';
import { DEFAULT_FILTER_STATE } from '../../../filters.js';
import { uuidv4 } from '../../../utils.js';
import { favsToHotswap } from '../../../RossAscends-mods.js';
import { onlyOwnChanges } from './mutations.js';

const TITLE = '편의성 모음';
const LIST = '#rm_print_characters_block';
const FLOAT_CLASS = 'stqa_char_tools_float';

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
    // Only what shows the favorite changes (redrawing the whole list is slow with many characters)
    document.querySelectorAll(`${LIST} .character_select[data-chid]`).forEach((row) => {
        if (characterOf(row) === character) {
            row.classList.toggle('is_fav', fav);
            decorate(row, row.querySelector('.stqa_char_tools')?.style.justifyContent ?? '');
        }
    });
    favsToHotswap();
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

/** Adds the buttons to a card (or brings its ☆ up to date); returns whether they were new. */
function decorate(row, justify) {
    const character = characterOf(row);
    if (!character) {
        return false;
    }
    let tools = row.querySelector('.stqa_char_tools');
    const added = !tools;
    if (added) {
        tools = document.createElement('div');
        tools.className = 'stqa_char_tools';
        tools.innerHTML = '<div class="stqa_char_tool" data-tool="fav" title="즐겨찾기"></div><div class="stqa_char_tool fa-solid fa-tag" data-tool="tag" title="태그"></div>';
        // Where the card's tags were, lined up the way the theme lines up the tags; the tags go
        // under it, smaller (CSS)
        const tags = row.querySelector('.tags');
        tags ? tags.before(tools) : row.append(tools);
        tools.style.justifyContent = justify;
    }
    const star = tools.firstElementChild;
    const look = `stqa_char_tool ${isFav(character) ? 'fa-solid stqa_on' : 'fa-regular'} fa-star`;
    star.className !== look && (star.className = look);
    return added;
}

/**
 * Where the tags were works when the card has room there (a tall picture beside it). In
 * compact themes it would add a line to every card: the buttons go to the card's top right
 * corner instead, out of the layout. Measured on a card each time the list is drawn.
 */
function placeTools() {
    const row = document.querySelector(`${LIST} .character_select[data-chid]`);
    const tools = row?.querySelector('.stqa_char_tools');
    if (!tools || !row.offsetHeight) {
        return;
    }
    document.body.classList.remove(FLOAT_CLASS);
    tools.style.display = 'none';
    const without = row.offsetHeight;
    tools.style.display = '';
    document.body.classList.toggle(FLOAT_CLASS, row.offsetHeight > without + 2);
}

function decorateAll() {
    if (!isOn('charListTools')) {
        return;
    }
    const rows = document.querySelectorAll(`${LIST} .character_select[data-chid]`);
    const tags = rows[0]?.querySelector('.tags');
    // One theme for every card: its tag alignment is read once
    const justify = tags ? getComputedStyle(tags).justifyContent : '';
    let added = false;
    rows.forEach(row => (added = decorate(row, justify) || added));
    // Measuring forces a layout: only when cards got new buttons (resizes come by the observer)
    added && placeTools();
}

// ST draws a list in several steps (cards, then their tags): one pass after it settles
let decorateTimer = 0;
function scheduleDecorate() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(decorateAll, 60);
}

/** Taps on the ★ / tag buttons (not openings of the character). */
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
    if (!tool) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    tool === 'fav' ? toggleFav(character) : openTagPopup([character.avatar]);
}

export function applyCharListTools() {
    const on = isOn('charListTools');
    document.body.classList.toggle('stqa_char_tools_on', on);
    decorateAll();
}

export function initCharListTools() {
    // Capture: runs before ST's own handler that opens the character
    document.getElementById('rm_print_characters_block')?.addEventListener('click', onListClick, true);
    // ST redraws the list (pages, filters, search): new rows get the buttons
    const list = document.querySelector(LIST);
    if (list) {
        new MutationObserver(records => !onlyOwnChanges(records) && isOn('charListTools') && scheduleDecorate()).observe(list, { childList: true, subtree: true });
        // Shown, resized or restyled by another theme: the room on a card may differ
        new ResizeObserver(placeTools).observe(list);
    }
    applyCharListTools();
}
