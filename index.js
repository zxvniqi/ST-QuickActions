// 편의성 모음 (Quick Actions) for SillyTavern
import { MODULE, getSettings } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { NAME_KINDS, initNameOverride, getStoredName, setOverride, setOverrideEnabled } from './name-override.js';
import { initSaveGuard } from './save-guard.js';
import { initSelectionTools } from './selection-tools.js';

const TOGGLES = [
    ['deleteButton', '메시지 메뉴에 삭제 버튼 표시'],
    ['chatPicker', '캐릭터 선택 시 채팅 목록 띄우기'],
    ['selectionTools', '글자 드래그 시 수정/삭제 버튼 띄우기'],
    ['saveGuard', '모바일 저장 보호 (화면 전환 시 바로 저장)'],
];

function buildPanel() {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const panel = document.createElement('div');
    panel.className = 'stqa_panel';
    panel.innerHTML = `
        <h3>편의성 모음</h3>
        <b>기능</b>
        ${TOGGLES.map(([key, label]) => `
            <label class="checkbox_label">
                <input type="checkbox" data-setting="${key}">
                <span>${label}</span>
            </label>`).join('')}
        <hr>
        <label class="checkbox_label">
            <input type="checkbox" class="stqa_name_toggle">
            <b>이름 치환 (모든 채팅에 적용)</b>
        </label>
        <small class="stqa_hint">적으면 {{char}} / {{user}}가 그 이름으로 바뀌어요. 비우면 원래 이름. 체크를 끄면 적어둔 이름은 그대로 두고 잠시 꺼져요.</small>
        <div class="stqa_name_fields">
            ${NAME_KINDS.map(kind => `
                <label class="stqa_name_field">
                    <span>{{${kind}}}</span>
                    <input class="text_pole" type="text" data-name-kind="${kind}">
                </label>`).join('')}
        </div>`;

    for (const input of panel.querySelectorAll('input[data-setting]')) {
        input.checked = settings[input.dataset.setting];
    }
    for (const input of panel.querySelectorAll('input[data-name-kind]')) {
        const kind = input.dataset.nameKind;
        input.value = getStoredName(kind);
        input.placeholder = (kind === 'char' ? context.name2 : context.name1) || '원래 이름';
    }
    const nameToggle = panel.querySelector('.stqa_name_toggle');
    const nameFields = panel.querySelector('.stqa_name_fields');
    nameToggle.checked = settings.nameOverride;
    nameFields.classList.toggle('stqa_off', !settings.nameOverride);

    panel.addEventListener('change', (event) => {
        if (event.target === nameToggle) {
            setOverrideEnabled(nameToggle.checked);
            nameFields.classList.toggle('stqa_off', !nameToggle.checked);
            return;
        }
        const key = event.target.dataset?.setting;
        if (!key) {
            return;
        }
        settings[key] = event.target.checked;
        SillyTavern.getContext().saveSettingsDebounced();
        if (key === 'deleteButton') {
            applyDeleteButtonSetting();
        }
    });
    panel.addEventListener('input', (event) => {
        const kind = event.target.dataset?.nameKind;
        if (kind) {
            setOverride(kind, event.target.value);
        }
    });
    return panel;
}

async function openPanel() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
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
    initDeleteButton();
    initChatPicker();
    initSaveGuard();
    initNameOverride();
    initSelectionTools();
    addMenuButton();
})();
