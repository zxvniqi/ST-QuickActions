export const MODULE = 'st_quick_actions';

const defaultSettings = Object.freeze({
    // The whole extension on / off
    enabled: true,
    layoutManager: true,
    qrBar: true,
    qrHistory: true,
    // Swiping a message a QR made runs the QR again (same answers) for a new swipe
    qrSwipe: true,
    regexFolders: true,
    presetFolders: true,
    toggleSetChips: true,
    rangeDelete: true,
    rangeHide: true,
    charListTools: true,
    chatExportAll: true,
    chatQuickRename: true,
    chatReplace: true,
    chatSearch: true,
    // Deleted messages kept for a while (days); the trash files of chats, by chat
    messageTrash: false,
    trashDays: 7,
    trashIndex: {},
    // ST's chat backups list: the open character's only, viewed as a chat
    backupView: true,
    errorLog: true,
    vertexProfileFix: true,
    entryTranslate: true,
    // Prompts / world info shown translated (reading only; originals are what is saved and sent)
    translationView: false,
    // google | ai (translateProfile: a connection profile id, '' = the connection in use)
    translateEngine: 'google',
    translateProfile: '',
    // '' = the built-in prompt
    translatePrompt: '',
    welcomeRecent: false,
    wandGrid: false,
    optionsGrid: false,
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
    // Tapping a swipe number lists the message's swipes
    swipeList: true,
    footerTop: true,
    // left | center | right
    footerSwipePos: 'left',
    footerTopPos: 'left',
    menuToBottom: true,
    // Floating shortcut panel
    floatingPanel: true,
    floatingButtons: { deleteLast: true, top: true, up: true, jump: true, down: true, bottom: true, hideRange: true, names: true },
    // Button keys in the order the panel shows them (ones left out follow, as listed)
    floatingOrder: [],
    // Menu items (wand / Options / input bar) added as shortcuts: [{ selector, key, label, icon }]
    floatingExtras: [],
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
    // Prompt (preset) names in the order the prompt list shows them
    presetOrder: [],
    folders: {},
    // Saved toggle combinations per prompt preset: { preset: [{ name, states: { identifier: on } }] }
    toggleSets: {},
    // Status panels in translated messages are taken from the original
    keepStatusPanels: true,
    hdAvatars: true,
    hideInputPlaceholder: false,
    hideSettingHints: true,
    // Korean for the parts of ST's screens its translation leaves in English
    koFill: true,
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
