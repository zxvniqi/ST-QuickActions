// Swipe list: tapping a message's swipe number (ST's own 2/3, or the one under the message) lists
// its swipes. Tap one to show it in the chat, or pick several and delete them at once (ST's own
// swipe deletion, so they go to the trash like any other).
import { MODULE, isOn } from './settings.js';
import { deleteSwipe } from '../../../../script.js';
import { showFullText } from './message-trash.js';

const TITLE = '편의성 모음';
const COUNTERS = '#chat .swipes-counter, #chat .stqa_footer_count';

const isGenerating = () => Boolean(document.getElementById('mes_stop')?.offsetParent);
const plain = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** ST's own swipe to a given one, so its rules and events apply. */
async function goTo(messageId, swipeId) {
    const context = SillyTavern.getContext();
    const message = context.chat[messageId];
    const current = message.swipe_id ?? 0;
    if (swipeId === current) {
        return;
    }
    await context.swipe.to(null, swipeId > current ? 'right' : 'left', { source: 'slash_command', message, forceMesId: messageId, forceSwipeId: swipeId });
}

async function openList(messageId) {
    const context = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = context;
    const message = context.chat[messageId];
    if (!Array.isArray(message?.swipes) || message.swipes.length < 2) {
        toastr.info('스와이프가 하나뿐입니다.', TITLE);
        return;
    }
    const content = document.createElement('div');
    content.className = 'stqa_trash stqa_swipe_list';
    let popup = null;
    let picking = false;

    const button = (icon, text, onClick, caution = false) => {
        const element = document.createElement('div');
        element.className = `menu_button menu_button_icon${caution ? ' caution' : ''}`;
        element.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
        element.querySelector('span').textContent = text;
        element.addEventListener('click', onClick);
        return element;
    };
    // The window was opened for this message: anything else going on stops the change
    const blocked = () => {
        if (SillyTavern.getContext().chat[messageId] !== message) {
            toastr.warning('그사이 채팅이 바뀌었습니다.', TITLE);
            return true;
        }
        if (isGenerating()) {
            toastr.info('답변을 만드는 중에는 쓸 수 없습니다.', TITLE);
            return true;
        }
        return false;
    };

    const render = () => {
        content.innerHTML = '<h3></h3><div class="stqa_hint"></div><div class="stqa_trash_items"></div>';
        content.querySelector('.stqa_hint').textContent = picking ? '지울 스와이프를 누르세요. 하나는 남아야 합니다.' : '누르면 그 스와이프로 바꿉니다. 카드 오른쪽 위 버튼은 크게 보기입니다.';
        content.querySelector('h3').textContent = `#${messageId} ${message.name ?? ''}의 스와이프 ${message.swipes.length}개`;
        content.classList.toggle('stqa_trash_picking', picking);
        const list = content.querySelector('.stqa_trash_items');
        const boxes = [];
        const deleteTicked = button('fa-trash', '', async () => {
            const picked = boxes.map((box, index) => (box.checked ? index : -1)).filter(index => index !== -1);
            if (!picked.length || blocked()) {
                return;
            }
            if (picked.length >= message.swipes.length) {
                toastr.warning('스와이프를 모두 지울 수는 없습니다. 하나는 남겨 주세요.', TITLE);
                return;
            }
            const confirmed = await new Popup(`스와이프 ${picked.length}개를 지웁니다.`, POPUP_TYPE.CONFIRM, '', { okButton: '삭제', cancelButton: '취소' }).show();
            if (!confirmed || blocked()) {
                return;
            }
            // From the back, so the numbers of the ones still to go stay the same
            for (const index of picked.sort((a, b) => b - a)) {
                await deleteSwipe(index, messageId);
            }
            picking = false;
            message.swipes.length < 2 ? popup?.completeCancelled() : render();
        }, true);
        const count = () => {
            const ticked = boxes.filter(box => box.checked).length;
            deleteTicked.querySelector('span').textContent = `선택한 ${ticked}개 삭제`;
            deleteTicked.hidden = !ticked;
        };
        const total = message.swipes.length;
        message.swipes.forEach((text, index) => {
            const current = index === (message.swipe_id ?? 0);
            const card = document.createElement('div');
            card.className = `stqa_trash_item stqa_swipe_card${current ? ' stqa_swipe_current' : ''}`;
            card.innerHTML = `
                <div class="stqa_swipe_card_head">
                    <input type="checkbox">
                    <span class="stqa_swipe_number"></span>
                    ${current ? '<span class="stqa_swipe_now">지금</span>' : ''}
                    <span class="stqa_swipe_size"></span>
                    <div class="menu_button fa-solid fa-expand" title="크게 보기"></div>
                </div>
                <div class="stqa_swipe_card_text"></div>`;
            card.querySelector('.stqa_swipe_number').textContent = `${index + 1} / ${total}`;
            card.querySelector('.stqa_swipe_size').textContent = `${String(text ?? '').length.toLocaleString()}자`;
            card.querySelector('.stqa_swipe_card_text').textContent = plain(text).slice(0, 400) || '(빈 스와이프)';
            const box = card.querySelector('input');
            boxes.push(box);
            const sync = () => {
                card.classList.toggle('stqa_swipe_ticked', box.checked);
                count();
            };
            box.addEventListener('change', sync);
            box.addEventListener('click', event => event.stopPropagation());
            card.querySelector('.fa-expand').addEventListener('click', (event) => {
                event.stopPropagation();
                showFullText(`#${messageId} ${message.name ?? ''} · 스와이프 ${index + 1}`, text, message);
            });
            // Picking: a tap ticks the card; otherwise it shows that swipe in the chat
            card.addEventListener('click', () => {
                if (picking) {
                    box.checked = !box.checked;
                    sync();
                    return;
                }
                if (blocked()) {
                    return;
                }
                popup?.completeCancelled();
                goTo(messageId, index).catch(error => console.error(`[${MODULE}] Swipe failed`, error));
            });
            list.append(card);
        });
        count();
        const bottom = document.createElement('div');
        bottom.className = 'stqa_trash_bottom';
        const pickButton = button(picking ? 'fa-xmark' : 'fa-list-check', picking ? '고르기 취소' : '여러 개 고르기', () => {
            picking = !picking;
            if (!picking) {
                boxes.forEach(box => (box.checked = false));
            }
            render();
        });
        bottom.append(deleteTicked, pickButton);
        content.append(bottom);
    };

    render();
    popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: '닫기', allowVerticalScrolling: true });
    const shown = popup.show();
    // The swipe on show in sight
    requestAnimationFrame(() => content.querySelector('.stqa_swipe_current')?.scrollIntoView({ block: 'center' }));
    await shown;
}

function onClick(event) {
    if (!isOn('swipeList')) {
        return;
    }
    const counter = event.target.closest(COUNTERS);
    const id = Number(counter?.closest('.mes')?.getAttribute('mesid'));
    if (!counter || !Number.isInteger(id)) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    openList(id).catch(error => console.error(`[${MODULE}] Swipe list failed`, error));
}

export function applySwipeList() {
    document.body.classList.toggle('stqa_swipe_list_on', isOn('swipeList'));
}

export function initSwipeList() {
    document.getElementById('chat')?.addEventListener('click', onClick, true);
    applySwipeList();
}
