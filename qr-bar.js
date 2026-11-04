// Quick Reply bar for any theme: one line per button set that scrolls sideways, round buttons.
// How the bar opens is a choice:
//  - arrow: an ▲ / ▼ button in the input bar (next to the wand) shows / hides the bar
//  - handle: a thin bar above the input; tap it to open the sets, tap elsewhere to close them
//  - sets: one line of set names; tap one to unfold its buttons as a list
// The look is CSS switched by classes on <body>; Quick Reply draws its bar anew now and then,
// so the set-name line is put back whenever that happens.
import { MODULE, getSettings, isOn } from './settings.js';

const STYLE_CLASS = 'stqa_qrc';
const OPEN_CLASS = 'stqa_qrc_unfolded';
const ARROW_ID = 'stqa_qr_arrow';
const SETS_CLASS = 'stqa_qr_setnames';
const ACTIVE_SET_CLASS = 'stqa_qr_set_open';

export const QR_MODES = Object.freeze([
    { value: 'arrow', label: '입력창 ▲▼ 버튼으로 접고 펼치기' },
    { value: 'handle', label: '입력창 위 얇은 바를 눌러 열기' },
    { value: 'sets', label: '세트 이름만 한 줄, 누르면 펼치기' },
]);

let QuickReplySet = null;
try {
    ({ QuickReplySet } = await import('../../quick-reply/src/QuickReplySet.js'));
} catch (error) {
    console.warn(`[${MODULE}] Quick Reply not available; set names are off`, error);
}

// The set unfolded in the "sets" shape (by name; not saved)
let openSet = null;

const mode = () => (QR_MODES.some(({ value }) => value === getSettings().qrMode) ? getSettings().qrMode : 'arrow');
const styled = () => document.body.classList.contains(STYLE_CLASS);

const CLOSING_CLASS = 'stqa_qrc_closing';
// Length of the thin bar's fade (style.css)
const FADE_MS = 140;
let closingTimer = null;

function setOpen(value) {
    const body = document.body;
    clearTimeout(closingTimer);
    // The thin bar fades its sets out before they go
    if (!value && mode() === 'handle' && body.classList.contains(OPEN_CLASS) && styled()) {
        body.classList.add(CLOSING_CLASS);
        closingTimer = setTimeout(() => {
            body.classList.remove(CLOSING_CLASS, OPEN_CLASS);
        }, FADE_MS);
    } else {
        body.classList.remove(CLOSING_CLASS);
        body.classList.toggle(OPEN_CLASS, value);
    }
    syncArrow();
}

function syncArrow() {
    const arrow = document.getElementById(ARROW_ID);
    if (arrow) {
        const open = document.body.classList.contains(OPEN_CLASS);
        arrow.classList.toggle('fa-chevron-down', open);
        arrow.classList.toggle('fa-chevron-up', !open);
        arrow.title = open ? 'QR 접기' : 'QR 펼치기';
    }
}

/** The ▲ / ▼ button, right after the wand. */
function syncArrowButton(wanted) {
    let arrow = document.getElementById(ARROW_ID);
    if (!wanted) {
        arrow?.remove();
        return;
    }
    if (!arrow) {
        arrow = document.createElement('div');
        arrow.id = ARROW_ID;
        arrow.className = 'fa-solid interactable';
        arrow.tabIndex = 0;
        arrow.addEventListener('click', () => {
            const open = !document.body.classList.contains(OPEN_CLASS);
            getSettings().qrCollapsed = !open;
            SillyTavern.getContext().saveSettingsDebounced();
            setOpen(open);
        });
    }
    const wand = document.getElementById('extensionsMenuButton');
    if (wand && arrow.previousElementSibling !== wand) {
        wand.after(arrow);
    } else if (!wand && !arrow.isConnected) {
        document.getElementById('leftSendForm')?.append(arrow);
    }
    syncArrow();
}

/** Set names for the button sets in the bar, in bar order. */
function setNames(bar) {
    const sets = QuickReplySet?.list ?? [];
    return [...bar.querySelectorAll(':scope > .qr--buttons')].map((dom, index) => ({
        dom,
        name: sets.find(set => set.dom === dom)?.name ?? `세트 ${index + 1}`,
    }));
}

/** The "sets" shape: a line of set names at the top of the bar; the open set shows as a list. */
function drawSetNames() {
    const bar = document.getElementById('qr--bar');
    if (!bar) {
        return;
    }
    let line = bar.querySelector(`:scope > .${SETS_CLASS}`);
    if (mode() !== 'sets' || !styled()) {
        line?.remove();
        bar.querySelectorAll(`.${ACTIVE_SET_CLASS}`).forEach(dom => dom.classList.remove(ACTIVE_SET_CLASS));
        return;
    }
    const sets = setNames(bar);
    if (!sets.some(({ name }) => name === openSet)) {
        openSet = null;
    }
    if (!line) {
        line = document.createElement('div');
        line.className = SETS_CLASS;
        line.addEventListener('click', (event) => {
            const chip = event.target.closest('[data-set]');
            if (chip) {
                openSet = openSet === chip.dataset.set ? null : chip.dataset.set;
                drawSetNames();
            }
        });
    }
    line.replaceChildren(...sets.map(({ name }) => {
        const chip = document.createElement('div');
        chip.className = `qr--button stqa_qr_setname${name === openSet ? ' stqa_active' : ''}`;
        chip.dataset.set = name;
        chip.textContent = name;
        return chip;
    }));
    for (const { dom, name } of sets) {
        dom.classList.toggle(ACTIVE_SET_CLASS, name === openSet);
    }
    if (bar.firstElementChild !== line) {
        bar.prepend(line);
    }
}

// Taps on QR buttons right after the sets opened are the same finger, not a choice
const OPEN_GUARD_MS = 400;
let openedAt = 0;

/** The thin bar opens / closes the sets on a full tap (not on touch-down, or the finger would land on a QR as they appear). */
function onClick(event) {
    if (!styled() || mode() !== 'handle') {
        return;
    }
    const bar = document.getElementById('qr--bar');
    if (event.target === bar) {
        const open = !document.body.classList.contains(OPEN_CLASS) || document.body.classList.contains(CLOSING_CLASS);
        openedAt = open ? Date.now() : 0;
        setOpen(open);
    } else if (bar?.contains(event.target) && Date.now() - openedAt < OPEN_GUARD_MS) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}

/** A tap outside the bar closes the sets. */
function onPointerDown(event) {
    if (!styled()) {
        return;
    }
    const bar = document.getElementById('qr--bar');
    const inBar = bar?.contains(event.target);
    if (mode() === 'handle') {
        if (!inBar && !event.target.closest?.('dialog')) {
            setOpen(false);
        }
    } else if (mode() === 'sets' && openSet && !inBar && !event.target.closest?.('dialog')) {
        openSet = null;
        drawSetNames();
    }
}

/** Desktop mice scroll vertically; a button line should move sideways. */
function onWheel(event) {
    const line = event.target.closest?.(`#qr--bar > .qr--buttons, #qr--bar > .${SETS_CLASS}`);
    if (!line || !styled() || Math.abs(event.deltaX) > Math.abs(event.deltaY) || line.scrollWidth <= line.clientWidth) {
        return;
    }
    line.scrollLeft += event.deltaY;
    event.preventDefault();
}

export function applyQrPreset() {
    const on = isOn('qrBar');
    const current = mode();
    document.body.classList.toggle(STYLE_CLASS, on);
    for (const { value } of QR_MODES) {
        document.body.classList.toggle(`stqa_qrc_${value}`, on && value === current);
    }
    syncArrowButton(on && current === 'arrow');
    setOpen(on && current === 'arrow' && !getSettings().qrCollapsed);
    drawSetNames();
}

export function initQrBar() {
    // Shapes of earlier versions
    delete getSettings().qrPreset;
    applyQrPreset();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    const form = document.getElementById('send_form');
    form?.addEventListener('wheel', onWheel, { passive: false });
    // Quick Reply replaces its bar when sets change; the wand may come later than this extension
    let timer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            drawSetNames();
            if (isOn('qrBar') && mode() === 'arrow') {
                syncArrowButton(true);
            }
        }, 50);
    });
    if (form) {
        observer.observe(form, { childList: true });
    }
    const left = document.getElementById('leftSendForm');
    if (left) {
        observer.observe(left, { childList: true });
    }
}
