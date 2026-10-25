// Prevents lost settings / character edits on mobile.
// ST saves edits 1 second after the last keystroke. When a phone backgrounds the browser
// within that second, timers freeze, and if the tab is then discarded the edit is lost.
// This saves pending edits immediately when the page is hidden, warns about a second ST tab
// in the same browser (an old tab overwrites newer settings when it saves), and checks on
// load whether the last edit actually reached the server.
import * as script from '../../../../script.js';
import { getSettings } from './settings.js';
import { stampSettingsEdit, rememberSavedStamp, checkLastSaveOnLoad } from './save-check.js';

const TAB_CHANNEL = 'st_quick_actions_tabs';
const TAB_ID = Math.random().toString(36).slice(2);
const TAB_COUNT_WAIT_MS = 600;
// Inputs that never touch settings: chat box, messages, this extension's own popups
const IGNORED_INPUTS = '#send_form, #chat, .stqa_picker';

let settingsDirty = false;
let characterDirty = false;
let channel = null;

function onUserInput(event) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(IGNORED_INPUTS)) {
        return;
    }
    if (target.closest('#form_create')) {
        characterDirty = true;
    } else {
        settingsDirty = true;
        stampSettingsEdit();
    }
}

async function flushPendingSaves() {
    if (!getSettings().saveGuard) {
        return;
    }
    const context = SillyTavern.getContext();

    if (characterDirty && context.menuType === 'character_edit' && context.characterId !== undefined) {
        characterDirty = false;
        // Same action ST's own debounced character save performs.
        document.getElementById('create_button')?.click();
    }

    if (settingsDirty) {
        settingsDirty = false;
        // saveSettings is not exposed via getContext(); the debounced version would stay
        // frozen in a hidden tab, so call the real one when available.
        typeof script.saveSettings === 'function' ? await script.saveSettings() : context.saveSettingsDebounced();
    }
}

function warnOtherTab() {
    if (getSettings().saveGuard) {
        toastr.warning('SillyTavern이 다른 탭에도 열려 있어요. 설정이 덮어써질 수 있으니 한쪽 탭은 닫아주세요.', '편의성 모음', { timeOut: 10000, preventDuplicates: true });
    }
}

function watchOtherTabs() {
    if (typeof BroadcastChannel !== 'function') {
        return;
    }
    channel = new BroadcastChannel(TAB_CHANNEL);
    channel.addEventListener('message', ({ data }) => {
        if (!data || data.from === TAB_ID) {
            return;
        }
        if (data.type === 'hello' || data.type === 'ping') {
            channel.postMessage({ type: 'here', from: TAB_ID, to: data.from, reason: data.type });
        }
        // A tab that just opened, or an answer to our own hello
        if (data.type === 'hello' || (data.type === 'here' && data.to === TAB_ID && data.reason === 'hello')) {
            warnOtherTab();
        }
    });
    channel.postMessage({ type: 'hello', from: TAB_ID });
}

/** How many other ST tabs are open in this browser (used by the save diagnosis). */
export function countOtherTabs() {
    return new Promise((resolve) => {
        if (!channel) {
            resolve(0);
            return;
        }
        const seen = new Set();
        const onMessage = ({ data }) => {
            if (data?.type === 'here' && data.to === TAB_ID) {
                seen.add(data.from);
            }
        };
        channel.addEventListener('message', onMessage);
        channel.postMessage({ type: 'ping', from: TAB_ID });
        setTimeout(() => {
            channel.removeEventListener('message', onMessage);
            resolve(seen.size);
        }, TAB_COUNT_WAIT_MS);
    });
}

export function initSaveGuard() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    document.addEventListener('input', onUserInput, true);
    document.addEventListener('change', onUserInput, true);
    eventSource.on(eventTypes.SETTINGS_UPDATED, () => {
        settingsDirty = false;
        rememberSavedStamp();
    });
    eventSource.on(eventTypes.CHARACTER_EDITED, () => { characterDirty = false; });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushPendingSaves();
        }
    });
    window.addEventListener('pagehide', flushPendingSaves);
    watchOtherTabs();

    if (getSettings().saveGuard) {
        // Ask the browser not to evict this site's storage when space runs low (no prompt in Chrome)
        navigator.storage?.persist?.().catch(() => {});
        checkLastSaveOnLoad();
    }
}
