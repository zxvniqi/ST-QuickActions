// Shapes for the Quick Reply bar above the chat input, for any theme: one scrolling line,
// smaller buttons, a fold button in the input bar. Everything is CSS switched by classes on
// <body>, so it keeps applying when the Quick Reply extension redraws its bar.
import { getSettings } from './settings.js';

const TOGGLE_ID = 'stqa_qr_toggle';

/** Presets: which shape classes each one switches on. */
export const QR_PRESETS = Object.freeze([
    { value: 'theme', label: '테마 그대로', classes: [] },
    { value: 'line', label: '한 줄 · 가로 스크롤', classes: ['stqa_qr_line'] },
    { value: 'line_fold', label: '한 줄 · 가로 스크롤 + 접기 버튼', classes: ['stqa_qr_line', 'stqa_qr_fold'] },
    { value: 'compact_fold', label: '작은 버튼 · 한 줄 + 접기 버튼', classes: ['stqa_qr_line', 'stqa_qr_compact', 'stqa_qr_fold'] },
    { value: 'wrap_fold', label: '여러 줄 (최대 2줄) + 접기 버튼', classes: ['stqa_qr_wrap', 'stqa_qr_fold'] },
]);

const ALL_CLASSES = [...new Set(QR_PRESETS.flatMap(preset => preset.classes))];

function updateToggle() {
    const toggle = document.getElementById(TOGGLE_ID);
    const collapsed = getSettings().qrCollapsed;
    if (toggle) {
        toggle.title = collapsed ? 'QR 펼치기' : 'QR 접기';
        toggle.classList.toggle('stqa_qr_toggle_off', collapsed);
    }
    document.body.classList.toggle('stqa_qr_collapsed', collapsed);
}

function addToggle() {
    const form = document.getElementById('leftSendForm');
    if (!form || document.getElementById(TOGGLE_ID)) {
        return;
    }
    const toggle = document.createElement('div');
    toggle.id = TOGGLE_ID;
    toggle.className = 'fa-solid fa-bolt interactable';
    toggle.tabIndex = 0;
    toggle.addEventListener('click', () => {
        const settings = getSettings();
        settings.qrCollapsed = !settings.qrCollapsed;
        SillyTavern.getContext().saveSettingsDebounced();
        updateToggle();
    });
    form.append(toggle);
}

/** Desktop mice scroll vertically; in the one-line shape that should move the bar sideways. */
function onWheel(event) {
    const bar = event.target.closest?.('#qr--bar');
    if (!bar || !document.body.classList.contains('stqa_qr_line') || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
    }
    if (bar.scrollWidth > bar.clientWidth) {
        bar.scrollLeft += event.deltaY;
        event.preventDefault();
    }
}

export function applyQrPreset() {
    const preset = QR_PRESETS.find(item => item.value === getSettings().qrPreset) ?? QR_PRESETS[0];
    for (const cls of ALL_CLASSES) {
        document.body.classList.toggle(cls, preset.classes.includes(cls));
    }
    updateToggle();
}

export function initQrBar() {
    addToggle();
    applyQrPreset();
    // Only the input area listens, so scrolling the chat stays untouched
    document.getElementById('send_form')?.addEventListener('wheel', onWheel, { passive: false });
}
