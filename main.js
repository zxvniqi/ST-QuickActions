// 편의성 모음 (Quick Actions) for SillyTavern
import { MODULE, getSettings } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { initNameOverride, applyNameSettings } from './name-override.js';
import { initSelectionTools } from './selection-tools.js';
import { initLayoutManager, applyLayoutSettings } from './layout-manager.js';
import { openLayoutEditor } from './layout-editor.js';
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
    { value: 'dock', label: '화면 아래' },
    { value: 'above', label: '글자 위' },
    { value: 'below', label: '글자 아래' },
];

/**
 * The settings window, one tab per place in ST a feature belongs to. Each feature:
 * [setting key, label, short description]. Extra controls (selects, buttons) go after the
 * feature they belong to, by key.
 */
const TABS = Object.freeze([
    {
        title: '메시지',
        features: [
            ['deleteButton', '삭제 버튼', 'Message Actions에 휴지통 버튼. 그 메시지 삭제'],
            ['menuToBottom', '↓ 버튼', 'Message Actions에 ↓ 버튼. 그 메시지 끝으로 스크롤'],
            ['footerSwipe', '‹ 1/3 › 버튼', '마지막 답변 왼쪽 아래. 이전·다음 답변, 끝에서 › 는 새 답변. ST 스와이프를 꺼도 동작'],
            ['footerTop', '↑ 버튼', '메시지 왼쪽 아래. 그 메시지 첫머리로 스크롤'],
            ['selectionTools', '드래그 수정/삭제', '메시지 글자를 드래그하면 수정·삭제 버튼. 번역문이면 원문의 같은 부분도 함께'],
            ['keepStatusPanels', '상태창 다시 그리기', '상태창(HTML)이 코드 그대로 보이면 그 메시지를 다시 그림. 번역은 유지'],
        ],
    },
    {
        title: '채팅',
        features: [
            ['chatPicker', '채팅 목록 먼저', '캐릭터를 고르면 채팅 목록 창부터 열림'],
            ['rangeDelete', '메시지 범위 삭제', 'Options 메뉴 항목. 첫 메시지와 끝 메시지를 눌러 그 사이 삭제'],
            ['welcomeRecent', '시작 화면 최근 채팅', '시작 화면에서 어시스턴트를 숨기고 최근 채팅을 모두 펼침'],
            ['hdAvatars', '프로필 사진 고화질', '채팅·캐릭터 목록 사진을 썸네일 대신 원본으로'],
        ],
    },
    {
        title: '입력창',
        features: [
            ['qrBar', 'QR바 모양', '접기형은 입력창 왼쪽 ⚡ 버튼으로 접기'],
            ['qrHistory', 'QR 입력 기록', 'QR 입력 창에 최근 입력 3개. 눌러서 넣기·복사'],
            ['hideInputPlaceholder', '안내 문구 숨기기', '입력창의 "Type a message…" 문구 숨김'],
        ],
    },
    {
        title: '바로가기',
        features: [
            ['floatingPanel', '바로가기 버튼', '⋯ 버튼을 누르면 펼쳐짐. 떠 있을 땐 꾹 눌러 이동, 바깥 스크롤 시 접힘'],
        ],
    },
    {
        title: '메뉴·폴더',
        features: [
            ['layoutManager', '메뉴 정리', '숨기기·순서 변경 적용. 끄면 원래 배치'],
            ['wandGrid', 'Extensions 메뉴 아이콘 격자', '아이콘만, 한 줄에 3개'],
            ['wandFolders', 'Extensions 메뉴 폴더', '메뉴 정리 창의 폴더 버튼으로 만들기'],
            ['regexFolders', '정규식 폴더', '정규식 창의 폴더 버튼'],
            ['presetFolders', '프리셋 폴더', '프리셋 칸 옆 📁 버튼'],
            ['toggleSetChips', '프롬프트 토글 조합', '프롬프트 목록 위 칩. 토글 조합 저장·적용'],
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
        <div class="stqa_feature_head">
            <label class="checkbox_label"><input type="checkbox" data-setting="${key}"><span></span></label>
            <i class="fa-solid fa-circle-info stqa_info" title="설명"></i>
        </div>
        <small class="stqa_desc" hidden></small>
        <div class="stqa_feature_extra"></div>`;
    row.querySelector('span').textContent = label;
    row.querySelector('.stqa_desc').textContent = description;
    row.querySelector('input').checked = getSettings()[key] !== false;
    row.querySelector('.stqa_info').addEventListener('click', () => {
        const desc = row.querySelector('.stqa_desc');
        desc.hidden = !desc.hidden;
    });
    return row;
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
        const button = document.createElement('div');
        button.className = 'menu_button stqa_panel_button';
        button.innerHTML = '<i class="fa-solid fa-list-check"></i> 메뉴 정리 열기';
        button.addEventListener('click', openLayoutEditor);
        extra.append(button);
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
