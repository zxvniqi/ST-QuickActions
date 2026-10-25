// Quick Actions for SillyTavern
import { MODULE, getSettings } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { NAME_KINDS, initNameOverride, getOverrides, onOverridesChanged, setOverride, hasOpenChat } from './name-override.js';
import { initSaveGuard } from './save-guard.js';

const TOGGLES = [
    ['deleteButton', '메시지 메뉴에 삭제 버튼 표시'],
    ['chatPicker', '캐릭터 선택 시 채팅 목록 띄우기'],
    ['saveGuard', '모바일 저장 보호 (화면 전환 시 바로 저장)'],
];

function createSettingsUI() {
    const container = document.getElementById('extensions_settings2');
    if (!container) {
        return;
    }
    const toggles = TOGGLES.map(([key, label]) => `
        <label class="checkbox_label">
            <input type="checkbox" data-setting="${key}">
            <span>${label}</span>
        </label>`).join('');
    const nameFields = NAME_KINDS.map(kind => `
        <label class="stqa_name_field">
            <span>{{${kind}}}</span>
            <input class="text_pole" type="text" data-name-kind="${kind}">
        </label>`).join('');

    container.insertAdjacentHTML('beforeend', `
        <div id="${MODULE}_settings" class="extension_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Quick Actions</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    ${toggles}
                    <hr>
                    <b>이름 치환 (현재 채팅에만 적용)</b>
                    <small class="stqa_hint">비워두면 원래 이름. QR에서는 <code>/qa-char 이름</code>, <code>/qa-user 이름</code>으로도 바꿀 수 있어요.</small>
                    ${nameFields}
                </div>
            </div>
        </div>`);

    const settings = getSettings();
    const panel = document.getElementById(`${MODULE}_settings`);

    for (const input of panel.querySelectorAll('input[data-setting]')) {
        input.checked = settings[input.dataset.setting];
    }
    panel.addEventListener('change', (event) => {
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

    const nameInputs = panel.querySelectorAll('input[data-name-kind]');
    const refreshNameInputs = (overrides) => {
        const context = SillyTavern.getContext();
        const enabled = hasOpenChat();
        for (const input of nameInputs) {
            const kind = input.dataset.nameKind;
            input.disabled = !enabled;
            // Don't rewrite the field being typed in (the stored value is trimmed).
            if (input !== document.activeElement) {
                input.value = overrides[kind];
            }
            input.placeholder = enabled ? (kind === 'char' ? context.name2 : context.name1) : '채팅을 먼저 열어주세요';
        }
    };
    refreshNameInputs(getOverrides());
    onOverridesChanged(refreshNameInputs);

    panel.addEventListener('input', (event) => {
        const kind = event.target.dataset?.nameKind;
        if (kind && hasOpenChat()) {
            setOverride(kind, event.target.value, { debounced: true });
        }
    });
}

(function init() {
    initDeleteButton();
    initChatPicker();
    initSaveGuard();
    createSettingsUI();
    initNameOverride();
})();
