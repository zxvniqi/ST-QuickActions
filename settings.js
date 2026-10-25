export const MODULE = 'st_quick_actions';

const defaultSettings = Object.freeze({
    deleteButton: true,
    chatPicker: true,
    saveGuard: true,
    selectionTools: true,
    selectionToolbarPosition: 'dock',
    nameOverride: true,
    charName: '',
    userName: '',
});

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    const settings = extensionSettings[MODULE];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }
    return settings;
}
