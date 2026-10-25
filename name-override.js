// Per-chat override of what {{char}} / {{user}} resolve to (e.g. an NPC inside a multi-character card).
// Works with both macro engines:
//  - experimental engine: an official MacroEnvBuilder provider rewrites env.names
//  - legacy engine: a registered macro shadows the built-in value, only while an override is set
import { MODULE } from './settings.js';

const META_KEY = `${MODULE}_names`;
export const NAME_KINDS = Object.freeze(['char', 'user']);
const PROVIDER_ORDER_LATE = 90;

// Hot-path cache: macro substitution runs many times per generation, so avoid getContext() there.
let overrides = { char: '', user: '' };
let isGroupChat = false;
const legacyRegistered = { char: false, user: false };
const changeListeners = new Set();

export function getOverrides() {
    return { ...overrides };
}

export function onOverridesChanged(listener) {
    changeListeners.add(listener);
}

function notifyChange() {
    for (const listener of changeListeners) {
        listener(getOverrides());
    }
}

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

function loadFromChat() {
    const { chatMetadata, groupId } = SillyTavern.getContext();
    const stored = chatMetadata?.[META_KEY] ?? {};
    overrides = {
        char: typeof stored.char === 'string' ? stored.char : '',
        user: typeof stored.user === 'string' ? stored.user : '',
    };
    isGroupChat = groupId !== undefined && groupId !== null;
    syncLegacyMacros();
    notifyChange();
}

export function hasOpenChat() {
    return Boolean(SillyTavern.getContext().getCurrentChatId());
}

/**
 * @param {'char'|'user'} kind
 * @param {string} value Empty string clears the override.
 * @param {{ debounced?: boolean }} [options]
 */
export async function setOverride(kind, value, { debounced = false } = {}) {
    const context = SillyTavern.getContext();
    if (!context.getCurrentChatId()) {
        throw new Error('No chat is open');
    }
    const name = String(value ?? '').trim();
    const stored = { ...(context.chatMetadata[META_KEY] ?? {}), [kind]: name };
    if (stored.char || stored.user) {
        context.chatMetadata[META_KEY] = stored;
    } else {
        delete context.chatMetadata[META_KEY];
    }

    overrides[kind] = name;
    syncLegacyMacros();
    notifyChange();
    debounced ? context.saveMetadataDebounced() : await context.saveMetadata();
}

function registerSlashCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();
    for (const kind of NAME_KINDS) {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: `qa-${kind}`,
            callback: async (_args, value) => {
                const context = SillyTavern.getContext();
                if (!context.getCurrentChatId()) {
                    toastr.warning('채팅을 먼저 열어주세요.', 'Quick Actions');
                    return '';
                }
                await setOverride(kind, String(value ?? ''));
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
            helpString: `<div>Overrides what <code>{{${kind}}}</code> resolves to in the current chat (saved with the chat). Call without a name to restore the default.</div>
                <div>Example: <code>/qa-${kind} NPC</code></div>`,
        }));
    }
}

export function initNameOverride() {
    const { macros, eventSource, eventTypes } = SillyTavern.getContext();
    macros?.envBuilder?.registerProvider?.(applyToEnv, PROVIDER_ORDER_LATE);
    eventSource.on(eventTypes.CHAT_CHANGED, loadFromChat);
    registerSlashCommands();
    loadFromChat();
}
