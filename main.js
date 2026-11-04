// 편의성 모음 (Quick Actions) for SillyTavern
import { MODULE, getSettings } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { initNameOverride, applyNameSettings } from './name-override.js';
import { initSelectionTools } from './selection-tools.js';
import { initLayoutManager, applyLayoutSettings } from './layout-manager.js';
import { openLayoutEditor } from './layout-editor.js';
import { openFolderEditor } from './folder-editor.js';
import { createInlineSelect } from './inline-select.js';
import { initMessageTools, applyMessageToolSettings } from './message-tools.js';
import { FLOATING_BUTTONS, FLOATING_LAYOUTS, initFloatingPanel, applyFloatingSettings } from './floating-panel.js';
import { QR_PRESETS, initQrBar, applyQrPreset } from './qr-bar.js';
import { initQrInput } from './qr-input.js';
import { initStatusGuard } from './status-guard.js';
import { initDisplayTweaks, applyDisplayTweaks } from './display-tweaks.js';
import { FOLDER_AREAS, initFolders, applyFolders } from './folders.js';
import { initPresetFolders, applyFolderButtons } from './preset-folders.js';
import { initToggleSets, applyToggleSets } from './prompt-toggle-sets.js';
import { initRangeDelete, applyRangeDelete } from './range-delete.js';

const TOOLBAR_POSITIONS = [
    { value: 'dock', label: '버튼 위치: 화면 아래' },
    { value: 'above', label: '버튼 위치: 선택한 글자 위' },
    { value: 'below', label: '버튼 위치: 선택한 글자 아래' },
];

// Folder kinds with their own editor button in the settings window
const FOLDER_EDITORS = Object.freeze({ wandFolders: 'wand', regexFolders: 'regex', presetFolders: 'presets' });

/**
 * The settings window, one tab per place in ST a feature belongs to. Each feature:
 * [setting key, name, description]. Extra controls (selects, buttons) go after the
 * feature they belong to, by key.
 */
const TABS = Object.freeze([
    {
        title: '메시지',
        features: [
            ['deleteButton', '메시지 삭제 버튼', '메시지 메뉴(메시지 오른쪽 위 ⋯ 버튼)에 휴지통 버튼을 추가합니다. 누르면 그 메시지 하나만 삭제합니다.'],
            ['menuToBottom', '메시지 끝으로 이동', '메시지 메뉴에 ↓ 버튼을 추가합니다. 누르면 그 메시지의 마지막 줄로 바로 내려갑니다. 긴 답변을 읽을 때 편합니다.'],
            ['footerSwipe', '답변 넘기기 버튼', '마지막 답변 아래에 ‹ 1/3 › 버튼을 표시합니다. ‹ 는 이전 답변, › 는 다음 답변이며, 마지막 답변에서 › 를 누르면 새 답변을 생성합니다. 켜면 ST 기본 스와이프 화살표와 답변 번호는 숨겨집니다.'],
            ['footerTop', '메시지 처음으로 이동', '메시지 왼쪽 아래에 ↑ 버튼을 표시합니다. 누르면 그 메시지의 첫 줄로 올라갑니다.'],
            ['selectionTools', '드래그로 수정·삭제', '메시지 글자를 드래그해 선택하면 수정·삭제 버튼이 나타납니다. 번역된 메시지라면 원문에서 같은 부분도 함께 고치거나 지웁니다.'],
            ['keepStatusPanels', '상태창 깨짐 복구', '상태창(HTML)이 그려지지 않고 코드 그대로 보이면 그 메시지를 자동으로 다시 그립니다. 번역은 그대로 유지됩니다.'],
        ],
    },
    {
        title: '채팅',
        features: [
            ['chatPicker', '채팅 목록 먼저 보기', '캐릭터를 누르면 마지막 채팅이 바로 열리는 대신, 그 캐릭터의 채팅 목록이 먼저 열립니다.'],
            ['rangeDelete', '메시지 범위 삭제', '옵션 메뉴(입력창 왼쪽 ☰)에 "메시지 범위 삭제"를 추가합니다. 기본 메시지 삭제와 같은 방식으로, 첫 메시지와 끝 메시지를 누르면 그 사이만 선택되고 아래 삭제 버튼으로 지웁니다.'],
            ['welcomeRecent', '시작 화면 최근 채팅', '채팅을 열기 전 시작 화면에서 어시스턴트 메시지를 숨기고, 최근 채팅 목록을 전부 펼쳐 보여 줍니다.'],
            ['hdAvatars', '프로필 사진 고화질', '채팅과 캐릭터 목록의 프로필 사진을 작은 썸네일 대신 원본 이미지로 표시합니다.'],
        ],
    },
    {
        title: '입력창',
        features: [
            ['qrBar', 'QR바 모양', '입력창 위 QR 버튼 줄을 시네마노트 스타일(둥근 버튼, 세트마다 한 줄)로 바꿉니다. 위쪽 손잡이를 누르면 펼치고 접습니다. "테마 그대로"를 고르면 지금 테마 모양을 그대로 씁니다.'],
            ['qrHistory', 'QR 입력창 도구', 'QR이 띄우는 입력창 오른쪽 위에 삭제·복사·기록 버튼을 추가합니다. 삭제는 지금 쓴 내용을 지우고, 복사는 지금 쓴 내용을 복사합니다. 기록은 최근 입력 3개를 보여 주며, 어느 QR에서 입력했든 함께 나옵니다.'],
            ['hideInputPlaceholder', '입력창 안내 문구 숨기기', '입력창에 흐리게 보이는 "Type a message…" 안내 문구를 숨깁니다.'],
        ],
    },
    {
        title: '바로가기',
        features: [
            ['floatingPanel', '바로가기 버튼', '자주 쓰는 동작을 버튼 하나에 모읍니다. "입력창 위에 펼치기"는 입력창 왼쪽 ⋯ 버튼을 누르면 입력창 바로 위에 한 줄로 펼쳐지며, 채팅을 가리지 않습니다. 떠 있는 버튼은 화면 가장자리에 붙어 있고, 꾹 눌러서 옮길 수 있습니다. 아래에서 보일 버튼을 고릅니다.'],
        ],
    },
    {
        title: '메뉴·폴더',
        features: [
            ['layoutManager', '메뉴 정리', '확장 메뉴, 옵션 메뉴, 상단 바, 입력창 버튼, 메시지 메뉴, 확장 설정의 항목을 숨기거나 순서를 바꿉니다. 끄면 원래 배치로 돌아갑니다.'],
            ['wandGrid', '확장 메뉴 아이콘 보기', '확장 메뉴(입력창 왼쪽 마법봉 버튼)를 글자 없이 아이콘만, 한 줄에 3개씩 보여 줍니다.'],
            ['wandFolders', '확장 메뉴 폴더', '확장 메뉴 항목을 폴더로 묶습니다. 메뉴에서 폴더를 누르면 안의 항목이 펼쳐집니다.'],
            ['regexFolders', '정규식 폴더', '정규식 목록을 폴더로 묶어 접고 펼칩니다. 정규식 실행 순서는 바뀌지 않습니다. 정규식 창의 "폴더" 버튼으로도 편집할 수 있습니다.'],
            ['presetFolders', '프리셋 폴더', '프롬프트 프리셋을 폴더로 묶습니다. 프리셋 선택 칸 옆 폴더 버튼을 누르면 폴더별로 보고 고를 수 있습니다.'],
            ['toggleSetChips', '프롬프트 토글 조합', '프롬프트 목록 위에 버튼을 추가합니다. 지금 켜고 끈 프롬프트 상태를 이름을 붙여 저장해 두고, 누르면 그 상태로 한 번에 바뀝니다. 프리셋마다 따로 저장됩니다.'],
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
}

function featureRow(key, label, description) {
    const row = document.createElement('div');
    row.className = 'stqa_feature';
    row.innerHTML = `
        <label class="checkbox_label stqa_feature_head"><input type="checkbox" data-setting="${key}"><span></span></label>
        <div class="stqa_desc"></div>
        <div class="stqa_feature_extra"></div>`;
    row.querySelector('span').textContent = label;
    row.querySelector('.stqa_desc').textContent = description;
    row.querySelector('input').checked = getSettings()[key] !== false;
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
    } else if (key === 'qrBar') {
        select(QR_PRESETS.map(({ value, label }) => ({ value, label })), settings.qrPreset, (value) => {
            settings.qrPreset = value;
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
        chips.innerHTML = FLOATING_BUTTONS.map(({ key: button, icon, label }) => `
            <label class="stqa_chip" title="${label}"><input type="checkbox" data-floating-button="${button}"><i class="fa-solid ${icon}"></i><span>${label}</span></label>`).join('');
        chips.querySelectorAll('input').forEach(input => (input.checked = settings.floatingButtons?.[input.dataset.floatingButton] !== false));
        extra.append(chips);
    } else if (key === 'layoutManager') {
        extra.append(panelButton('fa-list-check', '메뉴 정리 열기', openLayoutEditor));
    } else if (FOLDER_EDITORS[key]) {
        extra.append(panelButton('fa-folder-tree', '폴더 편집', () => openFolderEditor(FOLDER_EDITORS[key])));
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
})();
