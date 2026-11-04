// Quick Reply bar in the Cinema Note look, for any theme: round buttons, one sideways-scrolling
// line per button set, and a small handle on top that unfolds / folds the sets. Everything is
// CSS switched by classes on <body>, so it keeps applying when Quick Reply redraws its bar.
import { getSettings, isOn } from './settings.js';

const STYLE_CLASS = 'stqa_qrc';
const UNFOLDED_CLASS = 'stqa_qrc_unfolded';

/** Presets: which sets show while the bar is folded. */
export const QR_PRESETS = Object.freeze([
    { value: 'theme', label: '테마 그대로' },
    { value: 'fold', label: '시네마노트 · 접어 두기 (손잡이로 펼치기)', classes: [STYLE_CLASS] },
    { value: 'lock1', label: '시네마노트 · 첫 세트만 보이기', classes: [STYLE_CLASS, 'stqa_qrc_lock1'] },
    { value: 'open', label: '시네마노트 · 모두 펼쳐 두기', classes: [STYLE_CLASS, 'stqa_qrc_open'] },
]);

const ALL_CLASSES = [...new Set(QR_PRESETS.flatMap(preset => preset.classes ?? []))];

const styled = () => document.body.classList.contains(STYLE_CLASS);

function setUnfolded(value) {
    document.body.classList.toggle(UNFOLDED_CLASS, value);
}

/** The handle unfolds / folds the sets; a tap outside the bar folds them, like the theme does. */
function onPointerDown(event) {
    if (!styled()) {
        return;
    }
    const bar = document.getElementById('qr--bar');
    if (!bar?.contains(event.target)) {
        // Popups a QR opens are not "outside"
        if (!event.target.closest?.('dialog')) {
            setUnfolded(false);
        }
        return;
    }
    // The bar itself, not a button set: the handle and the space around it
    if (event.target === bar) {
        setUnfolded(!document.body.classList.contains(UNFOLDED_CLASS));
    }
}

/** Desktop mice scroll vertically; a button line should move sideways. */
function onWheel(event) {
    const line = event.target.closest?.('#qr--bar > .qr--buttons');
    if (!line || !styled() || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
    }
    if (line.scrollWidth > line.clientWidth) {
        line.scrollLeft += event.deltaY;
        event.preventDefault();
    }
}

export function applyQrPreset() {
    // Switched off as a whole: the theme's own bar
    const preset = (isOn('qrBar') && QR_PRESETS.find(item => item.value === getSettings().qrPreset)) || QR_PRESETS[0];
    for (const cls of ALL_CLASSES) {
        document.body.classList.toggle(cls, Boolean(preset.classes?.includes(cls)));
    }
    setUnfolded(false);
}

export function initQrBar() {
    applyQrPreset();
    document.addEventListener('pointerdown', onPointerDown, true);
    // Only the input area listens, so scrolling the chat stays untouched
    document.getElementById('send_form')?.addEventListener('wheel', onWheel, { passive: false });
    // Left over from earlier versions
    delete getSettings().qrCollapsed;
}
