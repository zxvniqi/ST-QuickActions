// Prevents lost settings / character edits on mobile.
// ST saves edits 1 second after the last keystroke. When a phone backgrounds the browser
// within that second, timers freeze, and if the tab is then discarded the edit is lost.
// This saves pending edits immediately when the page is hidden, and warns about a second
// ST tab in the same browser (an old tab overwrites newer settings when it saves).
import * as script from '../../../../script.js';
import { getSettings } from './settings.js';

const TAB_CHANNEL = 'st_quick_actions_tabs';
// Inputs that never touch settings: chat box, messages, this extension's own popups
const IGNORED_INPUTS = '#send_form, #chat, .stqa_picker';

let settingsDirty = false;
let characterDirty = false;

function onUserInput(event) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(IGNORED_INPUTS)) {
        return;
    }
    if (target.closest('#form_create')) {
        characterDirty = true;
    } else {
        settingsDirty = true;
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

function watchOtherTabs() {
    if (typeof BroadcastChannel !== 'function') {
        return;
    }
    const channel = new BroadcastChannel(TAB_CHANNEL);
    channel.addEventListener('message', (event) => {
        if (event.data === 'hello') {
            channel.postMessage('here');
        }
        if (getSettings().saveGuard && (event.data === 'hello' || event.data === 'here')) {
            toastr.warning('SillyTavern이 다른 탭에도 열려 있어요. 설정이 덮어써질 수 있으니 한쪽 탭은 닫아주세요.', 'Quick Actions', { timeOut: 10000, preventDuplicates: true });
        }
    });
    channel.postMessage('hello');
}

export function initSaveGuard() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    document.addEventListener('input', onUserInput, true);
    document.addEventListener('change', onUserInput, true);
    eventSource.on(eventTypes.SETTINGS_UPDATED, () => { settingsDirty = false; });
    eventSource.on(eventTypes.CHARACTER_EDITED, () => { characterDirty = false; });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushPendingSaves();
        }
    });
    window.addEventListener('pagehide', flushPendingSaves);
    watchOtherTabs();
}
