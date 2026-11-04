export const MODULE = 'st_quick_actions';

const defaultSettings = Object.freeze({
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
