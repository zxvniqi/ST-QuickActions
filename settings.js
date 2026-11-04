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
    floatingButtons: { deleteLast: true, deleteRange: true, top: true, jump: true, bottom: true, qrRerun: true },
    floatingPosition: null,
    // vertical | horizontal | input (buttons in the input bar instead of floating)
    floatingLayout: 'vertical',
    floatingCollapsed: true,
    // Quick Reply bar shape
    qrPreset: 'theme',
    qrCollapsed: false,
    // Past answers to QR input popups: { "set.label#step": string[] }
    qrInputHistory: {},
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
