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
import { initErrorLog } from './error-log.js';
import { initVertexProfileFix } from './vertex-profile-fix.js';
import { initCharListTools, applyCharListTools } from './char-list-tools.js';
import { initChatExport, applyChatExport } from './chat-export.js';
import { initChatName, applyChatName } from './chat-name.js';
import { initChatReplace, applyChatReplace } from './chat-replace.js';
import { initChatSearch, applyChatSearch } from './chat-search.js';
import { initMessageTrash, applyMessageTrash, purge as purgeTrash } from './message-trash.js';
import { initSwipeList, applySwipeList } from './swipe-list.js';
import { initBackupView, applyBackupView } from './backup-view.js';
import { initKoFill } from './ko-fill.js';
import { initPromptRenderFix } from './prompt-render-fix.js';
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
            ['deleteButton', '삭제 버튼 꺼내 두기', '편집(연필)을 눌러야 보이는 휴지통 버튼을 연필 옆에 꺼내 둠.\n· 지우는 방식은 ST와 같음\n· 스와이프가 여러 개인 마지막 답변은 그 스와이프만 지울지 물음(ST 삭제 확인이 켜져 있을 때)'],
            ['menuToBottom', '메시지 끝으로 가기', '메시지 추가 메뉴(연필과 같은 곳)에 ↓ 버튼. 누르면 그 메시지 마지막 줄로 감.'],
            ['footerSwipe', '답변 넘기기 버튼', '마지막 답변 아래에 ‹ 1/3 ›.\n· ‹ 이전 답변, › 다음 답변\n· 마지막 답변에서 › 는 새로 생성\n· 켜 두면 ST 스와이프 화살표는 숨김\n· 위치는 아래에서 고름'],
            ['swipeList', '스와이프 목록', '스와이프 번호(2/3)를 누르면 그 메시지의 스와이프가 카드로 뜸.\n· 카드: 번호, 글자 수, 앞부분. 보고 있는 건 "지금"\n· 카드를 누르면 그 스와이프로 바뀜, 오른쪽 위 버튼으로 전체 보기\n· "여러 개 고르기"로 한 번에 삭제(하나는 남음)\n· 휴지통이 켜져 있으면 지운 스와이프도 휴지통으로'],
            ['footerTop', '메시지 처음으로 가기', '메시지 아래에 ↑ 버튼. 누르면 그 메시지 첫 줄로 감. 위치는 아래에서 고름.'],
            ['selectionTools', '드래그해서 수정·삭제', '글자를 드래그해 고르면 "수정"·"삭제" 버튼이 뜸.\n· 수정: 고른 부분만 고치는 창\n· 삭제: 고른 부분만 지움(뜨는 알림을 누르면 되돌림)\n· 번역된 메시지면 원문의 같은 부분도 함께\n· 버튼 위치는 아래에서 고름'],
            ['keepStatusPanels', '상태창 렌더링 픽스', '주점 도우미(Tavern Helper) 상태창이 번역·다시 불러오기 뒤에 코드로 보이면 다시 그림. 번역문은 그대로 둠.'],
        ],
    },
    {
        title: '채팅',
        features: [
            ['chatPicker', '캐릭터 누르면 채팅 목록부터', '캐릭터 목록·즐겨찾기 줄에서 캐릭터를 누르면 마지막 채팅 대신 채팅 목록부터 뜸.\n· 목록에서 채팅 고르기, 이름 바꾸기·내보내기·삭제\n· 위쪽 아이콘으로 채팅 전체 zip 내보내기·불러오기'],
            ['chatExportAll', '채팅 전체 내보내기·불러오기', '채팅 목록 창(Chat History) "채팅 가져오기" 옆에 아이콘 두 개.\n· zip: 그 캐릭터 채팅 전부를 zip 하나로 받기\n· 폴더: zip이나 .jsonl 여러 개를 원래 이름 그대로 불러오기\n· 이름이 겹치면 뒤에 (2), 원래 채팅은 그대로'],
            ['chatQuickRename', '채팅 이름 한 번에 바꾸기', '채팅 목록 창의 연필 옆에 사람 버튼.\n· 페르소나 이름, 페르소나 + 날짜, 캐릭터 이름, 캐릭터 + 날짜 중 골라 바로 바꿈\n· 페르소나는 그 채팅에 고정한 것(없으면 지금 것), 날짜는 채팅 만든 날'],
            ['rangeDelete', '메시지 범위 삭제', '옵션 메뉴(입력창 왼쪽 ☰)에 "메시지 범위 삭제".\n· 첫 메시지와 끝 메시지를 누르면 그 사이만 체크(ST 기본은 끝까지)\n· 입력창 자리의 삭제 버튼으로 지우고, 취소로 나옴'],
            ['rangeHide', '메시지 범위 숨기기', '옵션 메뉴에 "메시지 범위 숨기기".\n· 범위 삭제처럼 첫·끝 메시지를 눌러 고르고 숨기기\n· 숨긴 메시지는 채팅에 남지만 AI에게 안 보냄, 눈 버튼으로 다시 보임\n· 바로가기 버튼에서는 번호를 적어서 숨김'],
            ['messageTrash', '메시지 휴지통', '지운 메시지를 휴지통에 보관. 옵션 메뉴 "휴지통"에서 되살리거나 완전히 삭제.\n· 어떤 방법으로 지워도 담김. 스와이프 하나만 지운 것도, 같은 메시지 것은 한 묶음\n· 되살리면 그 메시지 스와이프 맨 뒤에 붙음(메시지가 없으면 원래 자리에 새로)\n· 보관 기간이 지나면 실리를 켤 때 정리\n· 최대 개수를 정하면 채팅마다 넘는 것은 오래된 것부터 삭제\n· 채팅을 지우면 그 휴지통도 삭제\n· 서버에 따로 저장해 그만큼 공간을 씀. ST 백업과는 별개'],
            ['backupView', '채팅 백업 캐릭터별로 보기·불러오기', '채팅 목록 창 "Backups"를 누르면 백업이 창으로 뜸.\n· 지금 캐릭터(그룹) 백업만 최신순, "전체"로 모든 캐릭터\n· 파일 이름 대신 저장 시각과 메시지 수\n· 보기: 채팅처럼 보여 줌(긴 메시지는 눌러서 펼침)\n· 불러오기: 새 채팅으로 들어옴, 지금 채팅은 그대로'],
            ['chatReplace', '채팅 단어 한꺼번에 바꾸기', '옵션 메뉴에 "채팅 단어 바꾸기". 지금 채팅의 모든 메시지에서 단어를 한꺼번에 바꿈(예: 상태창 2024 → 2205).\n· 스와이프와 번역문도 같이\n· 답변 생성 중에는 못 씀'],
            ['chatSearch', '채팅에서 찾기', '옵션 메뉴에 "채팅에서 찾기". 위에 검색칸, 입력창 자리에 ▲ ▼ ✕.\n· 가장 최근에 나온 곳으로 가서 형광펜, 지금 위치는 진한 주황\n· ▲ 위쪽(더 옛날), ▼ 아래쪽 결과\n· 아래 칸: "몇 번째 메시지 · 그 안에서 몇 번째"\n· 안 불러온 옛 메시지도 찾아서 불러옴\n· 폰은 엔터로 검색만(키보드 내려감), 컴퓨터는 엔터마다 다음 결과'],
            ['welcomeRecent', '시작 화면에 최근 채팅 펼치기', '채팅을 열기 전 시작 화면에서 어시스턴트 메시지, 로고·버전, 링크·임시 채팅 버튼을 숨기고 최근 채팅을 모두 펼침.'],
        ],
    },
    {
        title: '캐릭터',
        features: [
            ['charListTools', '목록에서 바로 즐겨찾기·태그', '캐릭터 목록의 캐릭터마다 ☆와 태그 버튼. 캐릭터를 열지 않고 즐겨찾기, 태그 붙이기·떼기·만들기.'],
            ['hdAvatars', '프로필 사진 고화질', '채팅과 캐릭터 목록의 프로필 사진을 썸네일 대신 원본으로.\n· 목록 사진은 화면에 보일 때, 원본을 다 받은 뒤에 바꿈\n· 큰 사진이 많아 느리면 이것부터 꺼 볼 것'],
        ],
    },
    {
        title: '입력창',
        features: [
            ['qrBar', 'QR바 정리', '입력창 위 QR 버튼을 세트별로 한 줄씩, 줄마다 옆으로 밀어서 넘김.\n· 여는 방법은 아래에서 고름: ▲▼ 버튼(마법봉 옆), 얇은 바(입력창 바로 위), 세트 이름'],
            ['qrHistory', 'QR 입력창 도구', 'QR 입력창 버튼 줄 왼쪽에 지우기·복사, 오른쪽에 최근 입력.\n· 최근 입력: 마지막 3개, 어느 QR에서 입력했든 함께'],
            ['qrSwipe', 'QR 답변도 스와이프로 다시 만들기', 'QR이 만든 메시지(/gen → /sendas 등)도 오른쪽으로 스와이프하면 다시 생성.\n· 그 QR을 같은 입력값으로 다시 실행, 결과는 다음 스와이프로\n· 켠 뒤에 QR로 만든 메시지부터 적용'],
            ['hideInputPlaceholder', '입력창 안내 문구 숨기기', '입력창에 흐리게 보이는 "Type a message…" 문구를 숨김.'],
        ],
    },
    {
        title: '바로가기',
        features: [
            ['floatingPanel', '바로가기 버튼', '자주 쓰는 버튼을 한곳에 모아 둠(최근 메시지 삭제, 맨 위·아래, 한 메시지 위·아래, 번호로 이동, 범위 숨기기, 이름 바꾸기).\n· 한 메시지 위·아래: 화면 맨 위 메시지 기준으로 하나씩\n· 보이는 방식: 입력창 위에 펼치기(··· 로 열고 닫기), 늘 보이기, 떠 있는 버튼(··· 를 꾹 눌러 끌어 옮김)\n· 칩을 눌러 보일 버튼을 고르고, 꾹 눌러 끌면 순서 바뀜\n· "메뉴 항목 추가"로 마법봉·옵션 메뉴·입력창 버튼도 넣을 수 있음'],
        ],
    },
    {
        title: '프롬프트',
        features: [
            ['presetFolders', '프롬프트 폴더·관리', '프롬프트(프리셋) 선택 칸을 누르면 폴더로 정리된 목록이 열림.\n· 목록 맨 아래 "프롬프트 관리": 순서 바꾸기, 폴더 만들기·옮기기, 여러 개 한꺼번에 삭제'],
            ['toggleSetChips', '빠른 전환 (항목 켜기·끄기 저장)', '프롬프트 항목 목록 위에 빠른 전환 버튼 줄.\n· "+ 빠른 전환 추가": 지금 켜고 끈 상태를 이름 붙여 저장\n· 버튼을 누르면 그 상태로 돌아감\n· ✎: 덮어쓰기·이름 바꾸기·삭제. 프롬프트마다 따로 저장'],
            ['entryTranslate', '프롬프트·월드인포·설명 번역해서 보기', '프롬프트, 월드인포, 캐릭터 설명을 한국어로 번역해서 봄. 저장·전송되는 건 항상 원문.\n· 목록 전체: 프롬프트 목록(✚ 옆 文A), 월드인포(페이지 넘김 옆 文A, 월드인포를 고른 뒤에 보임)\n· 하나씩: 편집 창·항목·캐릭터 설명의 文A 번역, ⇄ 원문/번역 보기, 지우개로 번역 삭제\n· 번역 중엔 버튼이 돌고, 다시 누르면 멈춤\n· 번역문을 보는 동안엔 고칠 수 없음. ⇄ 로 원문으로 돌린 뒤 고칠 것\n· 번역은 이 기기에 저장. 다른 방식으로 다시 하려면 지우개로 먼저 지움\n· 방식은 아래에서 고름: 구글(기본) 또는 AI(API와 번역 프롬프트 따로 지정)'],
        ],
    },
    {
        title: '메뉴 정리',
        features: [
            ['layoutManager', '메뉴 정리', '확장 메뉴, 옵션 메뉴, 상단 바, 입력창 버튼, 메시지 메뉴, 확장 설정의 항목을 숨기거나 순서를 바꿈. 끄면 원래대로.'],
            ['wandGrid', '확장 메뉴를 아이콘으로', '확장 메뉴(마법봉)를 아이콘만, 한 줄에 2개씩.\n· 꾹 누르면 이름이 잠깐 뜸(그때는 실행 안 됨), 컴퓨터는 마우스를 올리면'],
            ['optionsGrid', '옵션 메뉴를 아이콘으로', '옵션 메뉴(☰)를 아이콘만, 한 줄에 2개씩.\n· 꾹 누르면 이름이 잠깐 뜸(그때는 실행 안 됨), 컴퓨터는 마우스를 올리면'],
            ['regexFolders', '정규식 폴더', '정규식 목록을 폴더로 묶어 접고 펼침. 실행 순서는 그대로. 폴더는 정규식 창 "폴더" 버튼에서 만듦.'],
        ],
    },
    {
        title: '화면·기타',
        features: [
            ['koFill', 'ST 한국어 번역 채우기·고치기', 'ST를 한국어로 쓸 때 영어로 남은 버튼·메뉴·설정·알림을 한국어로 채우고, 뜻이 틀린 번역을 고쳐 보여 줌(예: "스포일러 무료 모드" → "스포일러 방지 모드").\n· 샘플러 용어, 서비스·모델 이름은 영어 그대로\n· 끄면 새로고침 뒤 원래대로'],
            ['hideSettingHints', 'ST 설정 설명 글씨 숨기기', 'ST 설정 항목 아래 흐린 설명 글씨를 모두 숨김.'],
            ['errorLog', '오류 알림 자세히 보기', '빨간 오류 알림에 돋보기 버튼. 누르면 최근 오류 내용이 창으로 뜸(복사 가능).\n· 서버가 돌려준 오류(API 오류 문구 등), 화면 스크립트 오류, 오류 알림을 최근 30개까지\n· 터묵스 화면에 찍힌 글은 못 읽음\n· 새로고침하면 사라짐'],
            ['vertexProfileFix', '연결 프로필 버텍스(서비스 계정) 오류 픽스', '확장이 연결 프로필로 요청할 때(번역, 요약 등) 버텍스 AI 서비스 계정에서 나는 오류를 고침.\n· 빠진 로그인 방식을 지금 버텍스 설정(서비스 계정, 프로젝트·지역)으로 채워 보냄\n· 연결 프로필을 쓰는 다른 확장에도 적용'],
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
    applyChatSearch();
    applyMessageTrash();
    applySwipeList();
    applyBackupView();
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
    } else if (key === 'messageTrash') {
        // 30 choices: the device's own option popup rather than a list unfolding in the window
        const days = document.createElement('select');
        days.className = 'text_pole stqa_trash_days_select';
        for (let day = 1; day <= 30; day++) {
            days.append(new Option(`보관 기간: ${day}일`, String(day), false, day === settings.trashDays));
        }
        days.addEventListener('change', () => {
            settings.trashDays = Number(days.value);
            saveSettings();
        });
        const most = document.createElement('select');
        most.className = 'text_pole stqa_trash_days_select';
        for (const count of [0, 10, 20, 30, 50, 100, 200]) {
            most.append(new Option(count ? `최대 ${count}개` : '최대 개수: 제한 없음', String(count), false, count === (Number(settings.trashMax) || 0)));
        }
        most.addEventListener('change', async () => {
            const before = Number(settings.trashMax) || 0;
            const next = Number(most.value);
            // A lower most cuts trash already kept: asked first
            if (next && (!before || next < before)
                && !await SillyTavern.getContext().Popup.show.confirm('휴지통', `채팅마다 ${next}개를 넘는 것은 오래된 것부터 지금 지워집니다.`)) {
                most.value = String(before);
                return;
            }
            settings.trashMax = next;
            saveSettings();
            purgeTrash();
        });
        extra.append(days, most);
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
    // The tabs stay on top; the features scroll under them, so the window keeps its size
    await new Popup(buildPanel(), POPUP_TYPE.TEXT, '', { okButton: '닫기', leftAlign: true }).show();
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
    initErrorLog();
    initVertexProfileFix().catch(error => console.error(`[${MODULE}] Vertex AI profile fix failed`, error));
    initPromptRenderFix().catch(error => console.error(`[${MODULE}] Prompt manager fix failed`, error));
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
    initChatSearch();
    initMessageTrash();
    initSwipeList();
    initBackupView();
    initKoFill();
    initEntryTranslate();
})();
