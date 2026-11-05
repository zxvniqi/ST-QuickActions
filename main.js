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
import { FLOATING_LAYOUTS, orderedFloatingButtons, initFloatingPanel, applyFloatingSettings } from './floating-panel.js';
import { QR_MODES, initQrBar, applyQrPreset } from './qr-bar.js';
import { initQrInput } from './qr-input.js';
import { initStatusGuard } from './status-guard.js';
import { initDisplayTweaks, applyDisplayTweaks } from './display-tweaks.js';
import { FOLDER_AREAS, initFolders, applyFolders } from './folders.js';
import { initPresetFolders, applyFolderButtons } from './preset-folders.js';
import { initToggleSets, applyToggleSets } from './prompt-toggle-sets.js';
import { initRangeDelete, applyRangeDelete } from './range-delete.js';
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
            ['deleteButton', '메시지 삭제 버튼', '메시지 메뉴(메시지 오른쪽 위 ⋯)에 휴지통 버튼을 추가합니다. 누르면 그 메시지 하나만 지웁니다.'],
            ['menuToBottom', '메시지 끝으로 이동', '메시지 메뉴에 ↓ 버튼을 추가합니다. 누르면 그 메시지의 마지막 줄로 내려갑니다. 긴 답변을 읽을 때 씁니다.'],
            ['footerSwipe', '답변 넘기기 버튼', '마지막 답변 아래에 ‹ 1/3 › 를 표시합니다. ‹ 는 이전 답변, › 는 다음 답변이고, 마지막 답변에서 › 를 누르면 새 답변을 만듭니다. 켜면 ST의 스와이프 화살표는 숨겨집니다. 위치(왼쪽·가운데·오른쪽)는 아래에서 고릅니다.'],
            ['footerTop', '메시지 처음으로 이동', '메시지 아래에 ↑ 버튼을 표시합니다. 누르면 그 메시지의 첫 줄로 올라갑니다. 위치는 아래에서 고릅니다.'],
            ['selectionTools', '드래그로 수정·삭제', '메시지 글자를 드래그해 고르면 수정·삭제 버튼이 나타납니다. 번역된 메시지면 원문의 같은 부분도 함께 고치거나 지웁니다.'],
            ['keepStatusPanels', '렌더링 픽스', '상태창 같은 HTML이 그려지지 않고 코드로 보이면 그 메시지를 다시 그립니다. 번역은 그대로 둡니다.'],
        ],
    },
    {
        title: '채팅',
        features: [
            ['chatPicker', '채팅 목록 먼저 보기', '캐릭터 목록이나 즐겨찾기 줄에서 캐릭터를 누르면, 마지막 채팅으로 바로 들어가지 않고 그 캐릭터의 채팅 목록을 먼저 보여 줍니다. 그 목록에서 채팅 이름 바꾸기·내보내기·지우기, 전체 내보내기·불러오기도 할 수 있습니다.'],
            ['chatExportAll', '채팅 전체 내보내기·불러오기', 'ST 채팅 목록(Chat History) 창의 검색칸 앞에 버튼 2개를 추가합니다. zip 아이콘은 그 캐릭터의 채팅을 모두 zip 파일 하나로 내려받고, 폴더 아이콘은 그 zip 파일(또는 .jsonl 여러 개)을 지금 캐릭터에 채팅 이름 그대로 불러옵니다. 같은 이름이 있으면 뒤에 (2)를 붙이고, 있던 채팅은 건드리지 않습니다.'],
            ['chatQuickRename', '채팅 이름 빠르게 바꾸기', 'ST 채팅 목록 창에서 채팅 이름 옆 ✎ 옆에 사람 모양 버튼을 추가합니다. 누르면 페르소나 이름, 페르소나 이름 + 날짜, 캐릭터 이름, 캐릭터 이름 + 날짜 중에서 골라 바꿉니다. 페르소나는 그 채팅에 고정한 페르소나(없으면 지금 페르소나), 날짜는 채팅을 만든 날짜입니다.'],
            ['rangeDelete', '메시지 범위 삭제', '옵션 메뉴(입력창 왼쪽 ☰)에 "메시지 범위 삭제"를 추가합니다. 첫 메시지와 끝 메시지를 누르면 그 사이가 골라지고, 아래 삭제 버튼으로 지웁니다.'],
            ['chatReplace', '채팅 단어 바꾸기', '옵션 메뉴에 "채팅 단어 바꾸기"를 추가합니다. 지금 채팅의 모든 메시지에서 한 단어를 다른 단어로 바꿉니다(예: 상태창의 2024 → 2205). 다른 답변(스와이프)과 번역문도 바꿉니다. 답변을 만드는 중에는 쓸 수 없습니다.'],
            ['welcomeRecent', '시작 화면 최근 채팅', '채팅을 열기 전 시작 화면에서 어시스턴트 메시지를 숨기고, 최근 채팅 목록을 모두 펼쳐 보여 줍니다.'],
        ],
    },
    {
        title: '캐릭터',
        features: [
            ['charListTools', '목록에서 즐겨찾기·태그', '캐릭터 목록의 캐릭터마다 ☆(즐겨찾기)와 태그 버튼을 추가합니다. 캐릭터를 열지 않고 즐겨찾기를 켜고 끄거나, 태그를 넣고 빼고 새로 만들 수 있습니다.'],
            ['hdAvatars', '프로필 사진 고화질', '채팅과 캐릭터 목록의 프로필 사진을 작은 썸네일 대신 원본 사진으로 보여 줍니다. 목록의 사진은 화면에 보일 때만 바꿉니다. 원본이 큰 캐릭터가 많으면 느려질 수 있습니다.'],
        ],
    },
    {
        title: '입력창',
        features: [
            ['qrBar', 'QR바 정리', '입력창 위 QR 버튼을 세트마다 한 줄로 정리하고, 줄마다 옆으로 밀어 넘기게 합니다. 여는 방식은 아래에서 고릅니다: ▲▼ 버튼(마법봉 옆), 얇은 바(입력창 바로 위), 세트 이름(이름을 누르면 그 세트가 펼쳐짐).'],
            ['qrHistory', 'QR 입력창 도구', 'QR이 띄우는 입력창의 OK·취소 줄 왼쪽에 지우기·복사, 오른쪽에 기록 버튼을 추가합니다. 기록은 최근 입력 3개를 보여 주며, 어느 QR에서 입력했든 함께 나옵니다.'],
            ['hideInputPlaceholder', '입력창 안내 문구 숨기기', '입력창에 흐리게 보이는 "Type a message…" 안내 문구를 숨깁니다.'],
        ],
    },
    {
        title: '바로가기',
        features: [
            ['floatingPanel', '바로가기 버튼', '자주 쓰는 동작을 한곳에 모읍니다. 보이는 방식은 아래에서 고릅니다: 입력창 위에 펼치기(입력창 왼쪽 ⋯ 버튼), 입력창 위에 항상 보이기, 떠 있는 버튼(화면 가장자리, 꾹 눌러 옮김). 아래 칩을 눌러 보일 버튼을 고르고, 칩을 꾹 누른 채 끌어서 순서를 바꿉니다.'],
        ],
    },
    {
        title: '프롬프트',
        features: [
            ['presetFolders', '프롬프트 폴더·관리', '프롬프트 선택 칸을 누르면 폴더로 묶인 목록이 열립니다. 목록 맨 아래 "프롬프트 관리"에서 순서 바꾸기, 폴더 만들기·옮기기, 여러 개 지우기를 합니다.'],
            ['toggleSetChips', '프롬프트 빠른 전환', '프롬프트 항목 목록 위에 버튼을 추가합니다. 지금 켜고 끈 상태를 이름 붙여 저장해 두면, 그 버튼을 눌러 한 번에 그 상태로 바꿉니다. ✎ 로 덮어쓰기·이름 바꾸기·지우기를 합니다. 프롬프트마다 따로 저장됩니다.'],
            ['entryTranslate', '번역 보기', '프롬프트, 월드인포, 캐릭터 설명을 한국어로 읽게 해 줍니다. 화면에 보이는 글만 바뀌고, 저장되고 AI에게 보내지는 것은 언제나 원문입니다.\n· 프롬프트 목록(이름과 토큰 사이)과 월드인포 도구 줄(월드인포를 고른 뒤): 꼬리표 아이콘은 이름, 줄글 아이콘은 내용을 번역하고, ⇄는 원문과 번역을 오가며, 지우개는 그 목록의 번역을 지웁니다.\n· 프롬프트 편집 창, 월드인포 항목, 캐릭터 설명: 文A(번역), ⇄(그것만 전환), 지우개(그것의 번역 지우기).\n· 번역 중에는 누른 버튼이 돌고 진행 수가 알림으로 나옵니다. 그 버튼을 다시 누르면 멈춥니다.\n· 점선 테두리가 번역문이고, 누르면 그것만 원문으로 돌아가 고칠 수 있습니다.\n· 번역기는 아래에서 고릅니다. 기본은 구글 번역이고, AI를 고르면 번역 프롬프트를 직접 쓸 수 있습니다. 번역은 이 기기에 저장해 두어 다시 번역하지 않습니다. 다른 번역기로 다시 하려면 지우개로 지운 뒤 번역합니다.'],
            ['hideSettingHints', '설정 설명 글씨 숨기기', 'ST 설정 항목 아래에 흐리게 붙은 설명 글씨(예: "생성되는 대답을 조금씩 표시합니다…")를 숨깁니다.'],
        ],
    },
    {
        title: '메뉴 정리',
        features: [
            ['layoutManager', '메뉴 정리', '확장 메뉴, 옵션 메뉴, 상단 바, 입력창 버튼, 메시지 메뉴, 확장 설정의 항목을 숨기거나 순서를 바꿉니다. 아래 "메뉴 정리 열기"에서 합니다. 끄면 원래대로 돌아갑니다.'],
            ['wandGrid', '확장 메뉴 아이콘 보기', '확장 메뉴(입력창 왼쪽 마법봉)를 글자 없이 아이콘만, 한 줄에 2개씩 보여 줍니다. 아이콘을 꾹 누르거나 마우스를 올리면 이름이 보입니다.'],
            ['regexFolders', '정규식 폴더', '정규식 목록을 폴더로 묶어 접고 펼칩니다. 실행 순서는 바뀌지 않습니다. 폴더 편집은 정규식 창의 "폴더" 버튼에서 합니다.'],
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

/** Translator: Google, or an AI (the connection in use or a saved connection profile) with its prompt. */
function translatorControls(settings) {
    const box = document.createElement('div');
    box.className = 'stqa_translator';
    const profiles = SillyTavern.getContext().extensionSettings.connectionManager?.profiles ?? [];
    const options = [
        { value: 'google', label: '번역기: 구글 번역 (기본)' },
        { value: 'ai:', label: '번역기: 지금 연결된 AI' },
        ...profiles.map(profile => ({ value: `ai:${profile.id}`, label: `번역기: AI 연결 프로필 "${profile.name}"` })),
    ];
    const current = settings.translateEngine === 'ai' ? `ai:${settings.translateProfile ?? ''}` : 'google';
    const prompt = document.createElement('div');
    prompt.className = 'stqa_translator_prompt';
    prompt.innerHTML = '<small>번역 프롬프트 · {{text}} 자리에 번역할 글이 들어갑니다. 비우면 기본 프롬프트를 씁니다.</small><textarea class="text_pole" rows="4"></textarea><div class="menu_button stqa_panel_button"><i class="fa-solid fa-rotate-left"></i><span>기본 프롬프트로</span></div>';
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
    prompt.hidden = current === 'google';
    box.append(createInlineSelect({
        // A profile deleted since: shown as the connection in use
        options,
        value: options.some(option => option.value === current) ? current : 'ai:',
        onChange: (value) => {
            settings.translateEngine = value === 'google' ? 'google' : 'ai';
            settings.translateProfile = value.startsWith('ai:') ? value.slice(3) : '';
            prompt.hidden = value === 'google';
            saveSettings();
        },
    }), prompt);
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
        chips.innerHTML = orderedFloatingButtons().map(({ key: button, icon, label }) => `
            <label class="stqa_chip" title="${label}"><input type="checkbox" data-floating-button="${button}"><i class="fa-solid ${icon}"></i><span>${label}</span></label>`).join('');
        chips.querySelectorAll('input').forEach(input => (input.checked = settings.floatingButtons?.[input.dataset.floatingButton] !== false));
        enableChipOrdering(chips, (keys) => {
            settings.floatingOrder = keys;
            saveSettings();
            applyFloatingSettings();
        });
        extra.append(chips);
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
