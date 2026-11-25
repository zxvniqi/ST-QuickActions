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
    // Chat lists' order: recent (latest message, ST's) | newest | oldest (when the chat was made)
    chatSort: true,
    chatSortMode: 'recent',
    // A reply that came back with nothing at all: delete | retry | both (null: from the count, as
    // before there was a choice), generated again up to this many times
    emptyReplyDelete: true,
    emptyReplyMode: null,
    emptyReplyRetries: 0,
    // A ··· menu on each prompt of the prompt list: copy, to the top / bottom, delete
    promptCopy: true,
    // Items of another prompt: brought in (by ✚), or one put in an item's place (교체 in ···)
    promptImport: true,
    // ☰ tapped, then the place tapped: the item moves there
    promptTapMove: true,
    // 교체 in an item's ··· (another prompt's item in its place)
    promptReplace: true,
    // While messages are being deleted (or hidden): ⇈ ↑ ↓ ⇊ over the delete bar
    rangeStepButtons: true,
    // Where 문서 번역 puts its buttons and shows translations
    entryTranslatePrompts: true,
    entryTranslateWorld: true,
    entryTranslateCharacter: true,
    // Deleted messages kept for a while (days); the trash files of chats, by chat
    messageTrash: false,
    trashDays: 7,
    // Most items one chat's trash keeps (0: no limit)
    trashMax: 0,
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
    // Extensions' settings added to the Options / wand / message menus and the shortcuts:
    // [{ key, label, icon, places: ('options' | 'wand' | 'floating' | 'message')[] }]
    extensionLinks: true,
    extensionLinkList: [],
    // Icons picked for extensions' links (and their shortcuts): { key: classes }
    extensionIcons: {},
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
    // A quick switch linked to a chat (one per chat): { chatKey: { preset, name } }
    toggleLinks: {},
    // Status panels in translated messages are taken from the original
    keepStatusPanels: true,
    // ⟳ in the message menu: draws a message again
    redrawButton: true,
    // Settings window rows starred (row ids), shown on its 즐겨찾기 page
    settingsFavorites: [],
    // Settings window colours: forest | ocean | rose | lavender | night | theme (the ST theme's)
    settingsPalette: 'forest',
    hdAvatars: true,
    hideInputPlaceholder: false,
    hideSettingHints: true,
    // Korean for the parts of ST's screens its translation leaves in English
    koFill: true,
    // World info: the editor's dropdown opens a window (search, starred ones, linked characters)
    worldPicker: true,
    worldFavorites: [],
    // Worlds looked at lately (newest first), and the order the window shows: default | recent
    worldRecent: [],
    worldSort: 'default',
    // Chats bound to a world, as they were seen: { world: [{ avatar, chat }] }
    worldChats: {},
    // Personas: memos shown in the list, connected characters by the name, folders
    personaTools: true,
    personaMemos: {},
    personaFolders: [],
    // Per container selector: { order: string[], hidden: string[] }
    layout: {},
});

const PALETTE_IDS = Object.freeze(['forest', 'ocean', 'rose', 'lavender', 'night', 'theme']);

/** A window opened from the settings window, in the settings window's colours (style.css). */
export function paintPalette(element) {
    const id = getSettings().settingsPalette;
    element.classList.add('stqa_palette');
    element.dataset.palette = PALETTE_IDS.includes(id) ? id : PALETTE_IDS[0];
    return element;
}

/** Whether a feature is on (and the extension as a whole). */
export function isOn(key) {
    const settings = getSettings();
    return settings.enabled !== false && settings[key] !== false;
}

// Settings objects already filled with the defaults (read very often: filled once, not each time)
const filled = new WeakSet();

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    const settings = extensionSettings[MODULE];
    if (filled.has(settings)) {
        return settings;
    }
    // ⟳ was part of 정규식 렌더링 픽스 before it had a switch of its own: it starts as that was
    if (!Object.hasOwn(settings, 'redrawButton') && settings.keepStatusPanels === false) {
        settings.redrawButton = false;
    }
    // 가져오기·교체 and ☰ moving were part of the ··· menu before: they start as it was
    for (const key of ['promptImport', 'promptTapMove']) {
        if (!Object.hasOwn(settings, key) && settings.promptCopy === false) {
            settings[key] = false;
        }
    }
    // 교체 was part of 가져오기·교체, and the delete mode's buttons part of the shortcuts
    if (!Object.hasOwn(settings, 'promptReplace') && settings.promptImport === false) {
        settings.promptReplace = false;
    }
    if (!Object.hasOwn(settings, 'rangeStepButtons') && settings.floatingPanel === false) {
        settings.rangeStepButtons = false;
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = structuredClone(value);
        }
    }
    filled.add(settings);
    return settings;
}
