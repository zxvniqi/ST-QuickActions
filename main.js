// 편의성 모음 (Quick Actions) for SillyTavern
import { MODULE, getSettings } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { NAME_KINDS, initNameOverride, getStoredName, setOverride, setOverrideEnabled, setStatusRealName, swapNames } from './name-override.js';
import { initSelectionTools } from './selection-tools.js';
import { initLayoutManager } from './layout-manager.js';
import { openLayoutEditor } from './layout-editor.js';
import { createInlineSelect } from './inline-select.js';
import { initMessageTools, applyMessageToolSettings } from './message-tools.js';
import { FLOATING_BUTTONS, FLOATING_LAYOUTS, initFloatingPanel, applyFloatingSettings } from './floating-panel.js';
import { QR_PRESETS, initQrBar, applyQrPreset } from './qr-bar.js';
import { initQrInput } from './qr-input.js';
import { initStatusGuard } from './status-guard.js';
import { initDisplayTweaks, applyDisplayTweaks } from './display-tweaks.js';
import { initFolders } from './folders.js';
import { initPresetFolders } from './preset-folders.js';
import { initPromptVariants } from './prompt-variants.js';

const TOOLBAR_POSITIONS = [
    { value: 'dock', label: '화면 아래 (입력창 위)' },
    { value: 'above', label: '선택한 글자 위' },
    { value: 'below', label: '선택한 글자 아래' },
];

// Top-level on/off settings shown as checkboxes: [key, label, what to re-apply]
const TOGGLES = {
    deleteButton: ['메시지 메뉴에 삭제 버튼', applyDeleteButtonSetting],
    chatPicker: ['캐릭터 고르면 채팅 목록'],
    selectionTools: ['글자 고르면 수정/삭제 버튼'],
    keepTranslation: ['원문 고쳐도 번역 유지 (연필 수정 포함)'],
    footerSwipe: ['‹ › 이전·다음 답변 (마지막 답변 아래)', applyMessageToolSettings],
    footerTop: ['↑ 그 메시지 맨 위로 (메시지 아래)', applyMessageToolSettings],
    menuToBottom: ['↓ 그 메시지 맨 아래로 (메시지 메뉴)', applyMessageToolSettings],
    floatingPanel: ['쓰기 (떠 있을 땐 꾹 눌러 옮기기)', applyFloatingSettings],
    keepStatusPanels: ['상태창이 코드로 보이면 다시 그리기'],
    hdAvatars: ['프로필 사진 고화질', applyDisplayTweaks],
    hideInputPlaceholder: ['입력창 안내 문구 숨기기', applyDisplayTweaks],
};

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

const toggle = key => `
    <label class="checkbox_label">
        <input type="checkbox" data-setting="${key}">
        <span>${TOGGLES[key][0]}</span>
    </label>`;

function buildPanel() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const panel = document.createElement('div');
    panel.className = 'stqa_panel';
    panel.innerHTML = `
        <h3>편의성 모음</h3>
        <small class="stqa_hint">눌러서 펼쳐요.</small>
        <details class="stqa_section">
            <summary><b>기본</b><small>삭제 버튼 · 채팅 목록 · 글자 수정/삭제</small></summary>
            ${toggle('deleteButton')}
            ${toggle('chatPicker')}
            ${toggle('selectionTools')}
            ${toggle('keepTranslation')}
            <div class="stqa_name_field">
                <span class="stqa_wide_label">수정/삭제 버튼 위치</span>
                <div class="stqa_toolbar_position"></div>
            </div>
        </details>
        <details class="stqa_section">
            <summary><b>메시지 버튼</b><small>‹ › · ↑ · ↓</small></summary>
            ${toggle('footerSwipe')}
            ${toggle('footerTop')}
            ${toggle('menuToBottom')}
        </details>
        <details class="stqa_section">
            <summary><b>바로가기</b><small>⋯ 버튼 · 놓는 곳 · 버튼 고르기</small></summary>
            ${toggle('floatingPanel')}
            <div class="stqa_name_field">
                <span class="stqa_wide_label">놓는 곳</span>
                <div class="stqa_floating_layout"></div>
            </div>
            <div class="stqa_chips stqa_floating_chips">
                ${FLOATING_BUTTONS.map(({ key, icon, label }) => `
                    <label class="stqa_chip"><input type="checkbox" data-floating-button="${key}"><i class="fa-solid ${icon}"></i><span>${label}</span></label>`).join('')}
            </div>
        </details>
        <details class="stqa_section">
            <summary><b>QR바</b><small>모양 · 접기(⚡)</small></summary>
            <div class="stqa_qr_preset"></div>
        </details>
        <details class="stqa_section">
            <summary><b>화면</b><small>상태창 · 고화질 프사 · 안내 문구</small></summary>
            ${toggle('keepStatusPanels')}
            ${toggle('hdAvatars')}
            ${toggle('hideInputPlaceholder')}
        </details>
        <details class="stqa_section">
            <summary><b>이름 치환</b><small>{{char}} · {{user}}</small></summary>
            <label class="checkbox_label">
                <input type="checkbox" class="stqa_name_toggle">
                <span>모든 채팅에 적용 (끄면 잠시 꺼짐)</span>
            </label>
            <div class="stqa_name_fields">
                ${NAME_KINDS.map(kind => `
                    <label class="stqa_name_field">
                        <span>{{${kind}}}</span>
                        <input class="text_pole" type="text" data-name-kind="${kind}" placeholder="">
                    </label>`).join('')}
                <div class="menu_button stqa_panel_button stqa_swap_names" title="{{char}}와 {{user}} 이름 서로 바꾸기"><i class="fa-solid fa-right-left"></i> 서로 바꾸기</div>
                <label class="checkbox_label">
                    <input type="checkbox" class="stqa_status_real_name">
                    <span>상태창에는 원래 이름</span>
                </label>
            </div>
        </details>
        <div class="menu_button stqa_panel_button stqa_layout_button"><i class="fa-solid fa-list-check"></i> 메뉴 정리 (숨기기·순서·마법봉 폴더)</div>
        <small class="stqa_hint">정규식 폴더는 정규식 창, 프리셋 폴더는 프리셋 칸 옆 <i class="fa-solid fa-folder-tree"></i> 버튼에 있어요.</small>`;

    for (const input of panel.querySelectorAll('input[data-setting]')) {
        input.checked = settings[input.dataset.setting];
    }
    for (const input of panel.querySelectorAll('input[data-floating-button]')) {
        input.checked = settings.floatingButtons?.[input.dataset.floatingButton] !== false;
    }
    const floatingChips = panel.querySelector('.stqa_floating_chips');
    floatingChips.classList.toggle('stqa_off', !settings.floatingPanel);

    panel.querySelector('.stqa_toolbar_position').append(createInlineSelect({
        options: TOOLBAR_POSITIONS,
        value: settings.selectionToolbarPosition,
        onChange: (value) => {
            settings.selectionToolbarPosition = value;
            saveSettings();
        },
    }));
    panel.querySelector('.stqa_floating_layout').append(createInlineSelect({
        options: FLOATING_LAYOUTS,
        value: settings.floatingLayout,
        onChange: (value) => {
            settings.floatingLayout = value;
            saveSettings();
            applyFloatingSettings();
        },
    }));
    panel.querySelector('.stqa_qr_preset').append(createInlineSelect({
        options: QR_PRESETS.map(({ value, label }) => ({ value, label })),
        value: settings.qrPreset,
        onChange: (value) => {
            settings.qrPreset = value;
            saveSettings();
            applyQrPreset();
        },
    }));

    const nameInputs = [...panel.querySelectorAll('input[data-name-kind]')];
    const showNames = () => {
        for (const input of nameInputs) {
            const kind = input.dataset.nameKind;
            input.value = getStoredName(kind);
            input.placeholder = (kind === 'char' ? context.name2 : context.name1) || '원래 이름';
        }
    };
    showNames();
    const nameToggle = panel.querySelector('.stqa_name_toggle');
    const nameFields = panel.querySelector('.stqa_name_fields');
    nameToggle.checked = settings.nameOverride;
    nameFields.classList.toggle('stqa_off', !settings.nameOverride);
    const statusToggle = panel.querySelector('.stqa_status_real_name');
    statusToggle.checked = settings.statusRealName;

    panel.addEventListener('change', (event) => {
        const target = event.target;
        if (target === nameToggle) {
            setOverrideEnabled(nameToggle.checked);
            nameFields.classList.toggle('stqa_off', !nameToggle.checked);
            return;
        }
        if (target === statusToggle) {
            setStatusRealName(statusToggle.checked);
            return;
        }
        if (target.dataset?.floatingButton) {
            settings.floatingButtons = { ...settings.floatingButtons, [target.dataset.floatingButton]: target.checked };
            saveSettings();
            applyFloatingSettings();
            return;
        }
        const key = target.dataset?.setting;
        if (!key) {
            return;
        }
        settings[key] = target.checked;
        saveSettings();
        TOGGLES[key][1]?.();
        if (key === 'floatingPanel') {
            floatingChips.classList.toggle('stqa_off', !target.checked);
        }
    });
    panel.addEventListener('input', (event) => {
        const kind = event.target.dataset?.nameKind;
        if (kind) {
            setOverride(kind, event.target.value);
        }
    });
    panel.querySelector('.stqa_swap_names').addEventListener('click', () => {
        swapNames();
        showNames();
        toastr.success('{{char}}와 {{user}} 이름을 바꿨어요.', '편의성 모음');
    });
    panel.querySelector('.stqa_layout_button').addEventListener('click', openLayoutEditor);
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
    initPromptVariants();
})();
