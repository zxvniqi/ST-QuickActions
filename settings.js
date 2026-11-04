export const MODULE = 'st_quick_actions';

const defaultSettings = Object.freeze({
    // The whole extension on / off
    enabled: true,
    layoutManager: true,
    qrBar: true,
    qrHistory: true,
    wandFolders: true,
    regexFolders: true,
    presetFolders: true,
    toggleSetChips: true,
    rangeDelete: true,
    welcomeRecent: false,
    wandGrid: false,
    // {{char}} and {{user}} names swapped while on
    nameSwap: false,
    deleteButton: true,
    chatPicker: true,
    selectionTools: true,
    selectionToolbarPosition: 'dock',
    keepTranslation: true,
    nameOverride: true,
    charName: '',
    userName: '',
    // Status panels drawn by display regex scripts keep the real names
    statusRealName: true,
    // Buttons on messages
    footerSwipe: true,
    footerTop: true,
    menuToBottom: true,
    // Floating shortcut panel
    floatingPanel: true,
    floatingButtons: { deleteLast: true, top: true, jump: true, bottom: true, qrRerun: true, names: true },
    floatingPosition: null,
    // input (a row above the input bar) | vertical | horizontal (floating)
    floatingLayout: 'input',
    floatingCollapsed: true,
    // Quick Reply bar: arrow | handle | sets (how it opens); folded by the arrow
    qrMode: 'arrow',
    qrCollapsed: false,
    // Last answers typed into QR input popups, any QR, newest first
    qrRecentInputs: [],
    // Folders: { area: [{ id, name, keys: string[] }] }; which ones are open is not kept
    folders: {},
    // Saved toggle combinations per prompt preset: { preset: [{ name, states: { identifier: on } }] }
    toggleSets: {},
    // Status panels in translated messages are taken from the original
    keepStatusPanels: true,
    hdAvatars: true,
    hideInputPlaceholder: false,
    // Per container selector: { order: string[], hidden: string[] }
    layout: {},
});

/** Whether a feature is on (and the extension as a whole). */
export function isOn(key) {
    const settings = getSettings();
    return settings.enabled !== false && settings[key] !== false;
}

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    const settings = extensionSettings[MODULE];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = structuredClone(value);
        }
    }
    return settings;
}
