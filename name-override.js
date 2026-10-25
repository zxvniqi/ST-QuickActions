// Global override of what {{char}} / {{user}} resolve to (e.g. an NPC inside a multi-character card).
// Works with both macro engines:
//  - experimental engine: an official MacroEnvBuilder provider rewrites env.names
//  - legacy engine: a registered macro shadows the built-in value, only while an override is set
import { getSettings } from './settings.js';

export const NAME_KINDS = Object.freeze(['char', 'user']);
const SETTING_KEYS = Object.freeze({ char: 'charName', user: 'userName' });
const PROVIDER_ORDER_LATE = 90;

// Hot-path cache: macro substitution runs many times per generation, so avoid getContext() there.
const overrides = { char: '', user: '' };
let isGroupChat = false;
const legacyRegistered = { char: false, user: false };

function applyToEnv(env) {
    if (overrides.user) {
        env.names.user = overrides.user;
    }
    if (overrides.char) {
        env.names.char = overrides.char;
    }
    // In 1:1 chats these names are derived from char/user, so keep them consistent.
    if (!isGroupChat && (overrides.char || overrides.user)) {
        env.names.group = env.names.groupNotMuted = env.names.char;
        env.names.notChar = env.names.user;
    }
}

// Fallbacks only matter if an override was cleared after the macro engine switched mode.
const legacyHandlers = {
    char: () => overrides.char || SillyTavern.getContext().name2,
    user: () => overrides.user || SillyTavern.getContext().name1,
};

function syncLegacyMacros() {
    const context = SillyTavern.getContext();
    // With the experimental engine the env provider does the work. Registering here would
    // bridge into the new registry and replace the built-in macro, so never do that.
    if (context.powerUserSettings?.experimental_macro_engine) {
        return;
    }
    for (const kind of NAME_KINDS) {
        const wanted = Boolean(overrides[kind]);
        if (wanted === legacyRegistered[kind]) {
            continue;
        }
        // registerMacro is deprecated, but it is the only hook the legacy engine offers.
        wanted ? context.registerMacro(kind, legacyHandlers[kind]) : context.unregisterMacro(kind);
        legacyRegistered[kind] = wanted;
    }
}

/** Rebuilds the hot-path cache: stored names apply only while the feature is switched on. */
function refreshOverrides() {
    const settings = getSettings();
    for (const kind of NAME_KINDS) {
        overrides[kind] = settings.nameOverride ? String(settings[SETTING_KEYS[kind]] ?? '').trim() : '';
    }
    syncLegacyMacros();
}

export function getStoredName(kind) {
    return getSettings()[SETTING_KEYS[kind]];
}

/**
 * @param {'char'|'user'} kind
 * @param {string} value Empty string restores the default name.
 */
export function setOverride(kind, value) {
    getSettings()[SETTING_KEYS[kind]] = String(value ?? '').trim();
    refreshOverrides();
    SillyTavern.getContext().saveSettingsDebounced();
}

/** Switches the override on/off without touching the stored names. */
export function setOverrideEnabled(enabled) {
    getSettings().nameOverride = enabled;
    refreshOverrides();
    SillyTavern.getContext().saveSettingsDebounced();
}

function registerSlashCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();
    for (const kind of NAME_KINDS) {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: `qa-${kind}`,
            callback: (_args, value) => {
                const name = String(value ?? '').trim();
                setOverride(kind, name);
                if (name) {
                    setOverrideEnabled(true);
                }
                const context = SillyTavern.getContext();
                return overrides[kind] || (kind === 'char' ? context.name2 : context.name1);
            },
            returns: `the name {{${kind}}} now resolves to`,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'name to use; leave empty to restore the default',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                }),
            ],
            helpString: `<div>Overrides what <code>{{${kind}}}</code> resolves to in every chat. Call without a name to restore the default.</div>
                <div>Example: <code>/qa-${kind} NPC</code></div>`,
        }));
    }
}

export function initNameOverride() {
    const { macros, eventSource, eventTypes } = SillyTavern.getContext();
    macros?.envBuilder?.registerProvider?.(applyToEnv, PROVIDER_ORDER_LATE);
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        const { groupId } = SillyTavern.getContext();
        isGroupChat = groupId !== undefined && groupId !== null;
    });
    refreshOverrides();
    registerSlashCommands();
}
