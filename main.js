// 편의성 모음 (Quick Actions) for SillyTavern
import { MODULE, getSettings } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { initNameOverride, applyNameSettings } from './name-override.js';
import { initSelectionTools } from './selection-tools.js';
import { initLayoutManager, applyLayoutSettings } from './layout-manager.js';
import { openLayoutEditor } from './layout-editor.js';
import { createInlineSelect } from './inline-select.js';
import { FOOTER_POSITIONS, initMessageTools, applyMessageToolSettings } from './message-tools.js';
import { FLOATING_LAYOUTS, orderedFloatingButtons, initFloatingPanel, applyFloatingSettings, pickMenuItems } from './floating-panel.js';
import { QR_MODES, initQrBar, applyQrPreset } from './qr-bar.js';
import { initQrInput } from './qr-input.js';
import { initStatusGuard } from './status-guard.js';
import { initDisplayTweaks, applyDisplayTweaks } from './display-tweaks.js';
import { FOLDER_AREAS, initFolders, applyFolders } from './folders.js';
import { initPresetFolders, applyFolderButtons } from './preset-folders.js';
import { initToggleSets, applyToggleSets } from './prompt-toggle-sets.js';
import { initRangeDelete, applyRangeDelete } from './range-delete.js';
import { initSaveGuard } from './save-guard.js';
import { initCharListTools, applyCharListTools } from './char-list-tools.js';
import { initChatExport, applyChatExport } from './chat-export.js';
import { initChatName, applyChatName } from './chat-name.js';
import { initChatReplace, applyChatReplace } from './chat-replace.js';
import { DEFAULT_TRANSLATE_PROMPT, initEntryTranslate, applyEntryTranslate } from './entry-translate.js';

const TOOLBAR_POSITIONS = [
    { value: 'dock', label: '버튼 위치: 화면 아래' },
    { value: 'above', label: '버튼 위치: 선택한 글자 위' },
    { value: 'below', label: '버튼 위치: 선택한 글자 아래' },
];
// Shortcut chips: hold this long to pick one up; a finger moving more before that is scrolling
const CHIP_HOLD_MS = 400;
const CHIP_TOLERANCE = 8;


/**
 * The settings window, one tab per place in ST a feature belongs to. Each feature:
 * [setting key, name, description]. Extra controls (selects, buttons) go after the
 * feature they belong to, by key.
 */
const TABS = Object.freeze([
    {
        title: '메시지',
        features: [
            ['deleteButton', '삭제 버튼 꺼내 두기', 'ST에서는 연필(편집)을 눌러야 보이는 휴지통 버튼을 연필 바로 옆에 꺼내 둡니다. 편집에 들어가지 않고 바로 지울 수 있습니다. 지우는 방식은 ST와 같아서, 보통은 그 메시지 하나를 지우고, 스와이프가 여러 개인 마지막 AI 답변은 지금 보이는 스와이프만 지울지 메시지 전체를 지울지 묻습니다(ST 설정의 메시지 삭제 확인이 켜져 있을 때).'],
            ['menuToBottom', '메시지 끝으로 가기', '메시지 버튼 줄의 추가 메뉴(연필 버튼과 같은 곳)에 ↓ 버튼이 생깁니다. 누르면 그 메시지의 마지막 줄로 내려갑니다.'],
            ['footerSwipe', '답변 넘기기 버튼', '마지막 답변 아래에 ‹ 1/3 › 이 생깁니다. ‹ 는 이전 답변, › 는 다음 답변을 보여 주고, 마지막 답변에서 › 를 누르면 새 답변을 만듭니다. 켜 두면 ST 기본 스와이프 화살표는 숨겨집니다. 위치는 아래에서 고릅니다.'],
            ['footerTop', '메시지 처음으로 가기', '메시지 아래에 ↑ 버튼이 생깁니다. 누르면 그 메시지의 첫 줄로 올라갑니다. 위치는 아래에서 고릅니다.'],
            ['selectionTools', '드래그해서 수정·삭제', '메시지 글자를 드래그해 고르면 "수정"과 "삭제" 버튼이 뜹니다. 수정은 고른 부분만 고치는 창을 열고, 삭제는 고른 부분만 지웁니다(지운 뒤 뜨는 알림을 누르면 되돌립니다). 번역된 메시지라면 원문의 같은 부분도 함께 수정·삭제합니다. 버튼이 뜨는 위치는 아래에서 고릅니다.'],
            ['keepStatusPanels', '상태창 렌더링 픽스', '주점 도우미(Tavern Helper)가 그리는 상태창이 번역이나 다시 불러오기 뒤에 그려지지 않고 코드로 보이면, 그 메시지를 다시 그려서 상태창이 보이게 합니다. 번역문은 그대로 둡니다.'],
        ],
    },
    {
        title: '채팅',
        features: [
            ['chatPicker', '캐릭터 누르면 채팅 목록부터', '캐릭터 목록이나 즐겨찾기 줄에서 캐릭터를 누르면, 마지막 채팅으로 바로 들어가지 않고 채팅 목록부터 보여 줍니다. 목록에서 들어갈 채팅을 고르거나 이름 바꾸기·내보내기·삭제를 할 수 있고, 위쪽 아이콘으로 채팅 전체를 zip으로 내보내거나 불러올 수 있습니다.'],
            ['chatExportAll', '채팅 전체 내보내기·불러오기', 'ST 채팅 목록 창(Chat History)의 "채팅 가져오기" 옆에 아이콘 두 개가 생깁니다. zip 아이콘을 누르면 그 캐릭터의 채팅을 전부 zip 파일 하나로 받고, 폴더 아이콘을 누르면 그 zip 파일(또는 .jsonl 파일 여러 개)을 원래 채팅 이름 그대로 불러옵니다. 이름이 겹치면 뒤에 (2)를 붙이며, 원래 있던 채팅은 건드리지 않습니다.'],
            ['chatQuickRename', '채팅 이름 한 번에 바꾸기', 'ST 채팅 목록 창에서 채팅 이름 옆 연필 버튼 옆에 사람 모양 버튼이 생깁니다. 누르면 페르소나 이름, 페르소나 이름 + 날짜, 캐릭터 이름, 캐릭터 이름 + 날짜 중 하나를 골라 바로 바꿀 수 있습니다. 페르소나는 그 채팅에 고정해 둔 페르소나(없으면 지금 페르소나)이고, 날짜는 채팅을 만든 날입니다.'],
            ['rangeDelete', '메시지 범위 삭제', '옵션 메뉴(입력창 왼쪽 ☰)에 "메시지 범위 삭제"가 생깁니다. ST의 "메시지 삭제"처럼 메시지마다 체크칸이 나오는데, 첫 메시지와 끝 메시지를 누르면 그 사이만 체크됩니다(ST 기본은 누른 메시지부터 끝까지). 입력창 자리에 뜨는 삭제 버튼으로 지우고, 취소 버튼으로 나옵니다.'],
            ['rangeHide', '메시지 범위 숨기기', '옵션 메뉴에 "메시지 범위 숨기기"가 생깁니다. 범위 삭제처럼 첫 메시지와 끝 메시지를 눌러 고르고, 입력창 자리에 뜨는 숨기기 버튼을 누르면 그 사이 메시지를 숨깁니다. 숨긴 메시지는 채팅에 남아 있지만 AI에게 보내지 않습니다. 다시 보이게 하려면 메시지의 눈 버튼을 누릅니다. 바로가기 버튼의 "메시지 범위 숨기기"로는 번호를 적어서(예: 3-10) 숨길 수 있습니다.'],
            ['chatReplace', '채팅 단어 한꺼번에 바꾸기', '옵션 메뉴에 "채팅 단어 바꾸기"가 생깁니다. 지금 채팅의 모든 메시지에서 어떤 단어를 다른 단어로 한꺼번에 바꿉니다(예: 상태창의 2024를 2205로). 다른 답변(스와이프)과 번역문도 같이 바꾸며, 답변을 만드는 중에는 쓸 수 없습니다.'],
            ['welcomeRecent', '시작 화면에 최근 채팅 펼치기', '채팅을 열기 전 시작 화면에서 어시스턴트 메시지를 숨기고, 최근 채팅 목록을 모두 펼쳐서 보여 줍니다.'],
        ],
    },
    {
        title: '캐릭터',
        features: [
            ['charListTools', '목록에서 바로 즐겨찾기·태그', '캐릭터 목록의 캐릭터마다 ☆(즐겨찾기)와 태그 버튼이 생깁니다. 캐릭터를 열지 않고도 즐겨찾기를 켜고 끄거나, 태그를 붙이고 떼고 새로 만들 수 있습니다.'],
            ['hdAvatars', '프로필 사진 선명하게', '채팅과 캐릭터 목록의 프로필 사진을 작은 썸네일 대신 원본 사진으로 보여 줍니다. 캐릭터 목록의 사진은 화면에 보일 때만 바꿉니다. 원본 사진이 큰 캐릭터가 많으면 느려질 수 있으니, 느리다면 이 기능부터 꺼 보세요.'],
        ],
    },
    {
        title: '입력창',
        features: [
            ['qrBar', 'QR바 정리', '입력창 위 QR 버튼을 세트별로 한 줄씩 정리하고, 줄마다 옆으로 밀어서 넘기게 합니다. 여는 방법은 아래에서 고릅니다. ▲▼ 버튼(마법봉 옆), 얇은 바(입력창 바로 위), 세트 이름(이름을 누르면 그 세트가 펼쳐짐) 중 하나입니다.'],
            ['qrHistory', 'QR 입력창 도구', 'QR이 띄우는 입력창에서 확인·취소 버튼 줄 왼쪽에 지우기·복사, 오른쪽에 최근 입력 버튼이 생깁니다. 최근 입력은 마지막으로 입력한 3개를 보여 주며, 어느 QR에서 입력했는지와 상관없이 함께 나옵니다.'],
            ['qrSwipe', 'QR 답변도 스와이프로 다시 만들기', 'QR이 만든 메시지(/gen으로 생성해 /sendas 등으로 올린 메시지)도 일반 답변처럼 오른쪽으로 스와이프하면 다시 만듭니다. 그 QR을 처음과 같은 입력값으로 다시 실행하고, 새로 나온 글은 새 메시지가 아니라 그 메시지의 다음 스와이프로 들어갑니다. 왼쪽으로 넘기면 이전 결과를 볼 수 있습니다. 이 기능을 켠 뒤 QR로 만든 메시지부터 적용됩니다.'],
            ['hideInputPlaceholder', '입력창 안내 문구 숨기기', '입력창에 흐리게 보이는 "Type a message…" 문구를 숨깁니다.'],
        ],
    },
    {
        title: '바로가기',
        features: [
            ['floatingPanel', '바로가기 버튼', '최근 메시지 삭제, 맨 위로, 한 메시지 위로, 번호로 이동, 한 메시지 아래로, 맨 아래로, 메시지 범위 숨기기, 이름 바꾸기 버튼을 한곳에 모아 둡니다. 한 메시지 위로·아래로는 지금 화면 맨 위에 보이는 메시지를 기준으로 하나씩 옮겨 갑니다. 버튼이 많아 줄이 넘치면 옆으로 밀어서 봅니다. 보이는 방식은 아래에서 고릅니다. 입력창 위에 펼치기(입력창 왼쪽 ··· 버튼으로 열고 닫기), 입력창 위에 늘 보이기, 떠 있는 버튼(화면 가장자리에 붙고, 꾹 눌러 옮김) 중 하나입니다. 떠 있는 버튼은 펼쳐도 ··· 자리가 그대로라서, 같은 곳을 한 번 더 누르면 닫힙니다. 아래 칩을 눌러 보일 버튼을 고르고, 칩을 꾹 누른 채 끌면 순서가 바뀝니다. "메뉴 항목 추가"를 누르면 확장 메뉴(마법봉), 옵션 메뉴, 입력창에 있는 버튼도 골라서 바로가기에 아이콘으로 넣을 수 있습니다. 누르면 원래 메뉴에서 누른 것과 같습니다.'],
        ],
    },
    {
        title: '프롬프트',
        features: [
            ['presetFolders', '프롬프트 폴더·관리', '프롬프트(프리셋) 선택 칸을 누르면 폴더로 정리된 목록이 열립니다. 목록 맨 아래 "프롬프트 관리"에서 순서를 바꾸고, 폴더를 만들거나 옮기고, 여러 개를 한꺼번에 지울 수 있습니다.'],
            ['toggleSetChips', '빠른 전환 (항목 켜기·끄기 저장)', '프롬프트 항목 목록 위에 빠른 전환 버튼 줄이 생깁니다. "+ 빠른 전환 추가"를 누르면 지금 켜고 끈 상태를 이름 붙여 저장하고, 저장한 버튼을 누르면 언제든 그 상태로 돌아갑니다. ✎ 를 누르면 덮어쓰기·이름 바꾸기·지우기를 할 수 있고, 프롬프트마다 따로 저장됩니다.'],
            ['entryTranslate', '프롬프트·월드인포·설명 번역해서 보기', '프롬프트, 월드인포, 캐릭터 설명을 한국어로 번역해서 볼 수 있습니다. 화면에 보이는 글만 바뀌고, 저장되거나 AI에게 보내지는 건 항상 원문입니다.\n· 프롬프트 목록(도구 줄의 ✚ 버튼 옆 文A)과 월드인포(페이지 넘김 옆 文A): 누르면 이름 번역하기, 내용 번역하기, 원문/번역문으로 보기, 저장한 번역 지우기 메뉴가 열립니다. 월드인포 버튼은 월드인포를 고른 뒤에만 보입니다.\n· 프롬프트 편집 창, 월드인포 항목, 캐릭터 설명: 文A로 그것만 번역하고, ⇄ 로 원문과 번역을 바꿔 보고, 지우개로 번역을 지웁니다.\n· 번역하는 동안 누른 버튼이 돌고, 몇 개째인지 알림이 뜹니다. 돌고 있는 버튼을 다시 누르면 멈춥니다.\n· 번역문은 원래 칸과 똑같은 모양으로, 같은 자리에 글자만 바뀌어 보입니다. 원래 칸의 글은 그대로라서 저장되는 건 항상 원문입니다. 번역문을 보는 동안에는 고칠 수 없으니, 고치려면 ⇄로 원문으로 돌린 뒤 고치세요.\n· 번역 방식은 아래에서 고릅니다. 기본은 구글 번역이고, AI를 고르면 쓸 API와 번역 프롬프트를 따로 정할 수 있습니다. 연결 프로필을 고르면 그 프로필의 API만 쓰고, 프롬프트는 여기 적은 것만 씁니다.\n· 번역은 이 기기에 저장해 두고 다시 번역하지 않습니다. 다른 방식으로 다시 번역하려면 먼저 지우개로 지우세요.'],
            ['hideSettingHints', 'ST 설정 설명 글씨 숨기기', 'ST 설정 항목 아래에 흐리게 붙어 있는 설명 글씨(예: "생성되는 대답을 조금씩 표시합니다…")를 모두 숨깁니다.'],
        ],
    },
    {
        title: '메뉴 정리',
        features: [
            ['layoutManager', '메뉴 정리', '확장 메뉴, 옵션 메뉴, 상단 바, 입력창 버튼, 메시지 메뉴, 확장 설정에 있는 항목을 숨기거나 순서를 바꿉니다. 아래 "메뉴 정리 열기"를 눌러 정리하고, 이 기능을 끄면 원래대로 돌아갑니다.'],
            ['wandGrid', '확장 메뉴를 아이콘으로', '확장 메뉴(입력창 왼쪽 마법봉)를 글자 없이 아이콘만, 한 줄에 2개씩 보여 줍니다. 아이콘을 꾹 누르면 위에 이름이 잠깐 뜹니다(그때는 실행되지 않습니다). 컴퓨터는 마우스를 올리면 보입니다.'],
            ['regexFolders', '정규식 폴더', '정규식 목록을 폴더로 묶어 접었다 펼 수 있습니다. 정규식이 실행되는 순서는 바뀌지 않습니다. 폴더는 정규식 창의 "폴더" 버튼에서 만들고 고칩니다.'],
        ],
    },
]);

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

/** Re-applies every feature (after one or the whole extension was switched). */
function applyAll() {
    applyDeleteButtonSetting();
    applyMessageToolSettings();
    applyFloatingSettings();
    applyQrPreset();
    applyDisplayTweaks();
    applyLayoutSettings();
    Object.keys(FOLDER_AREAS).forEach(applyFolders);
    applyFolderButtons();
    applyToggleSets();
    applyRangeDelete();
    applyNameSettings();
    applyCharListTools();
    applyChatExport();
    applyChatName();
    applyChatReplace();
    applyEntryTranslate();
}

function featureRow(key, label, description) {
    const row = document.createElement('div');
    row.className = 'stqa_feature';
    row.innerHTML = `
        <div class="stqa_feature_head">
            <label class="checkbox_label"><input type="checkbox" data-setting="${key}"><span></span></label>
            <div class="stqa_desc_toggle fa-solid fa-circle-question" title="도움말"></div>
        </div>
        <div class="stqa_desc" hidden></div>
        <div class="stqa_feature_extra"></div>`;
    row.querySelector('span').textContent = label;
    row.querySelector('.stqa_desc').textContent = description;
    row.querySelector('input').checked = getSettings()[key] !== false;
    // ? opens the help under the name, and closes it again
    row.querySelector('.stqa_desc_toggle').addEventListener('click', () => {
        const desc = row.querySelector('.stqa_desc');
        desc.hidden = !desc.hidden;
        row.classList.toggle('stqa_desc_open', !desc.hidden);
    });
    return row;
}

function panelButton(icon, text, onClick) {
    const button = document.createElement('div');
    button.className = 'menu_button stqa_panel_button';
    button.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    button.querySelector('span').textContent = text;
    button.addEventListener('click', onClick);
    return button;
}

/** Long-press a chip, then drag it among the others to move it; a short tap still ticks it. */
function enableChipOrdering(chips, onReorder) {
    // The tap that ends a drag must not tick the chip it lands on
    let quietUntil = 0;
    chips.addEventListener('click', (event) => {
        if (Date.now() < quietUntil) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
    chips.addEventListener('contextmenu', event => event.preventDefault());
    chips.addEventListener('pointerdown', (event) => {
        const chip = event.target.closest('.stqa_chip');
        if (!chip) {
            return;
        }
        const start = { x: event.clientX, y: event.clientY };
        let dragging = false;
        const timer = setTimeout(() => {
            dragging = true;
            chip.classList.add('stqa_dragging');
            navigator.vibrate?.(15);
        }, CHIP_HOLD_MS);
        const onMove = (moveEvent) => {
            if (!dragging) {
                // Moving before the hold is a scroll
                if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > CHIP_TOLERANCE) {
                    end();
                }
                return;
            }
            const other = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.stqa_chip');
            if (other && other !== chip && other.parentElement === chips) {
                const box = other.getBoundingClientRect();
                moveEvent.clientX > box.left + box.width / 2 ? other.after(chip) : other.before(chip);
            }
        };
        // While dragging the window must not scroll under the finger
        const onTouchMove = touchEvent => dragging && touchEvent.preventDefault();
        const end = () => {
            clearTimeout(timer);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
            document.removeEventListener('touchmove', onTouchMove);
            if (dragging) {
                chip.classList.remove('stqa_dragging');
                quietUntil = Date.now() + 400;
                onReorder([...chips.querySelectorAll('input')].map(input => input.dataset.floatingButton));
            }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
    });
}

/**
 * Translator: Google, or an AI. For the AI, the API (the one in use, or a saved connection
 * profile's) and the prompt are set apart: a profile lends only its API, never its preset.
 */
function translatorControls(settings) {
    const box = document.createElement('div');
    box.className = 'stqa_translator';
    const profiles = SillyTavern.getContext().extensionSettings.connectionManager?.profiles ?? [];
    const methods = [
        { value: 'google', label: '번역 방식: 구글 번역 (기본)' },
        { value: 'ai', label: '번역 방식: AI' },
    ];
    // Which API the AI translation goes to; the prompt below is chosen on its own
    const connections = [
        { value: '', label: 'AI 연결: 지금 쓰고 있는 API' },
        ...profiles.map(profile => ({ value: profile.id, label: `AI 연결: ${profile.name} (연결 프로필)` })),
    ];
    const ai = document.createElement('div');
    ai.className = 'stqa_translator_ai';
    const prompt = document.createElement('div');
    prompt.className = 'stqa_translator_prompt';
    prompt.innerHTML = '<small>번역 프롬프트: {{text}} 자리에 번역할 글이 들어갑니다.</small><textarea class="text_pole" rows="5"></textarea><div class="menu_button stqa_panel_button"><i class="fa-solid fa-rotate-left"></i><span>기본 프롬프트로 되돌리기</span></div>';
    const area = prompt.querySelector('textarea');
    area.value = settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT;
    area.addEventListener('input', () => {
        settings.translatePrompt = area.value.trim() === DEFAULT_TRANSLATE_PROMPT ? '' : area.value;
        saveSettings();
    });
    prompt.querySelector('.menu_button').addEventListener('click', () => {
        area.value = DEFAULT_TRANSLATE_PROMPT;
        settings.translatePrompt = '';
        saveSettings();
    });
    ai.append(createInlineSelect({
        options: connections,
        // A profile deleted since: shown as the API in use
        value: connections.some(option => option.value === settings.translateProfile) ? settings.translateProfile : '',
        onChange: (value) => {
            settings.translateProfile = value;
            saveSettings();
        },
    }), prompt);
    ai.hidden = settings.translateEngine !== 'ai';
    box.append(createInlineSelect({
        options: methods,
        value: settings.translateEngine === 'ai' ? 'ai' : 'google',
        onChange: (value) => {
            settings.translateEngine = value;
            ai.hidden = value !== 'ai';
            saveSettings();
        },
    }), ai);
    return box;
}

/** Controls that belong to a feature: shown under it. */
function extrasFor(key) {
    const settings = getSettings();
    const extra = document.createDocumentFragment();
    const select = (options, value, onChange) => extra.append(createInlineSelect({ options, value, onChange }));
    if (key === 'selectionTools') {
        select(TOOLBAR_POSITIONS, settings.selectionToolbarPosition, (value) => {
            settings.selectionToolbarPosition = value;
            saveSettings();
        });
    } else if (key === 'footerSwipe' || key === 'footerTop') {
        const setting = key === 'footerSwipe' ? 'footerSwipePos' : 'footerTopPos';
        select(FOOTER_POSITIONS, settings[setting], (value) => {
            settings[setting] = value;
            saveSettings();
            applyMessageToolSettings();
        });
    } else if (key === 'entryTranslate') {
        extra.append(translatorControls(settings));
    } else if (key === 'qrBar') {
        select(QR_MODES, settings.qrMode, (value) => {
            settings.qrMode = value;
            saveSettings();
            applyQrPreset();
        });
    } else if (key === 'floatingPanel') {
        select(FLOATING_LAYOUTS, settings.floatingLayout, (value) => {
            settings.floatingLayout = value;
            saveSettings();
            applyFloatingSettings();
        });
        const chips = document.createElement('div');
        chips.className = 'stqa_chips';
        // Menu items' names and icons come from other extensions: set as text and classes, not markup
        const renderChips = () => {
            chips.replaceChildren(...orderedFloatingButtons().map(({ key: button, icon, label }) => {
                const chip = document.createElement('label');
                chip.className = 'stqa_chip';
                chip.title = label;
                chip.innerHTML = '<input type="checkbox"><i></i><span></span>';
                chip.querySelector('input').dataset.floatingButton = button;
                chip.querySelector('input').checked = settings.floatingButtons?.[button] !== false;
                chip.querySelector('i').className = /\bfa-(solid|regular|brands)\b/.test(icon) ? icon : `fa-solid ${icon}`;
                chip.querySelector('span').textContent = label;
                return chip;
            }));
        };
        renderChips();
        enableChipOrdering(chips, (keys) => {
            settings.floatingOrder = keys;
            saveSettings();
            applyFloatingSettings();
        });
        extra.append(chips, panelButton('fa-plus', '메뉴 항목 추가 (마법봉·옵션·입력창)', async () => {
            if (await pickMenuItems()) {
                renderChips();
            }
        }));
    } else if (key === 'layoutManager') {
        extra.append(panelButton('fa-list-check', '메뉴 정리 열기', openLayoutEditor));
    }
    return extra;
}

function buildPanel() {
    const settings = getSettings();
    const panel = document.createElement('div');
    panel.className = 'stqa_panel';
    panel.innerHTML = `
        <div class="stqa_panel_head">
            <h3>편의성 모음</h3>
            <label class="checkbox_label stqa_master"><input type="checkbox" data-setting="enabled"><span>사용</span></label>
        </div>
        <div class="stqa_tabs"></div>
        <div class="stqa_tab_body"></div>`;
    panel.querySelector('[data-setting="enabled"]').checked = settings.enabled !== false;
    const tabs = panel.querySelector('.stqa_tabs');
    const body = panel.querySelector('.stqa_tab_body');
    const pages = TABS.map(({ title, features }) => {
        const page = document.createElement('div');
        page.className = 'stqa_tab_page';
        for (const [key, label, description] of features) {
            const row = featureRow(key, label, description);
            row.querySelector('.stqa_feature_extra').append(extrasFor(key));
            page.append(row);
        }
        const tab = document.createElement('div');
        tab.className = 'stqa_tab';
        tab.textContent = title;
        tabs.append(tab);
        body.append(page);
        return { tab, page };
    });
    const show = (index) => pages.forEach(({ tab, page }, i) => {
        tab.classList.toggle('stqa_tab_active', i === index);
        page.hidden = i !== index;
    });
    pages.forEach(({ tab }, index) => tab.addEventListener('click', () => show(index)));
    show(0);
    const syncMaster = () => body.classList.toggle('stqa_off', settings.enabled === false);
    syncMaster();

    panel.addEventListener('change', (event) => {
        const target = event.target;
        if (target.dataset?.floatingButton) {
            settings.floatingButtons = { ...settings.floatingButtons, [target.dataset.floatingButton]: target.checked };
        } else if (target.dataset?.setting) {
            settings[target.dataset.setting] = target.checked;
        } else {
            return;
        }
        saveSettings();
        syncMaster();
        applyAll();
    });
    return panel;
}

async function openPanel() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    await new Popup(buildPanel(), POPUP_TYPE.TEXT, '', { okButton: '닫기', leftAlign: true, allowVerticalScrolling: true }).show();
}

function addMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return;
    }
    const item = document.createElement('div');
    item.id = `${MODULE}_menu`;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-toolbox extensionsMenuExtensionButton"></div><span>편의성 모음</span>';
    item.addEventListener('click', openPanel);
    menu.append(item);
}

(function init() {
    // First, before anything else can save a chat
    initSaveGuard();
    initDeleteButton();
    initChatPicker();
    initNameOverride();
    initSelectionTools();
    initMessageTools();
    initQrBar();
    addMenuButton();
    initLayoutManager();
    initFloatingPanel();
    initQrInput();
    initStatusGuard();
    initDisplayTweaks();
    initFolders();
    initPresetFolders();
    initToggleSets();
    initRangeDelete();
    initCharListTools();
    initChatExport();
    initChatName();
    initChatReplace();
    initEntryTranslate();
})();
