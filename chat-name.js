// Chat names after the persona: a chat still named as ST names it ("캐릭터 - 2026-11-05@12h30m15s")
// is renamed "페르소나 - 2026-11-05@12h30m15s" when opened, after the persona tied to it (locked
// to the chat), or the persona in use. Renamed again when the persona changes. Chats named by
// hand are left alone: only names made of the character's or a persona's name and ST's date.
import { MODULE, isOn } from './settings.js';

// The date ST puts after a new chat's name
const DATE_PART = / - (\d{4}-\d{1,2}-\d{1,2}\s?@\d{1,2}h\s?\d{1,2}m\s?\d{1,2}s(?:\s?\d+ms)?)$/;
const DELAY_MS = 800;

let timer = null;

const cleanName = name => String(name ?? '').replace(/[\\/:*?"<>|]/g, '').trim();

function personaName(context) {
    const locked = context.chatMetadata?.persona;
    return cleanName((locked && context.powerUserSettings?.personas?.[locked]) || context.name1);
}

/** The name the current chat should have, or null when it is fine (or named by hand). */
function wantedName(context) {
    const character = context.characters[context.characterId];
    const current = context.getCurrentChatId?.();
    if (!character || context.groupId || !current) {
        return null;
    }
    const match = String(current).match(DATE_PART);
    const persona = personaName(context);
    if (!match || !persona) {
        return null;
    }
    const prefix = current.slice(0, match.index);
    const personas = Object.values(context.powerUserSettings?.personas ?? {}).map(cleanName);
    if (prefix === persona || (prefix !== cleanName(character.name) && !personas.includes(prefix))) {
        return null;
    }
    return `${persona} - ${match[1]}`;
}

async function renameNow() {
    const context = SillyTavern.getContext();
    if (!isOn('chatNamePersona') || document.getElementById('mes_stop')?.offsetParent) {
        return;
    }
    const target = wantedName(context);
    if (!target) {
        return;
    }
    const current = context.getCurrentChatId();
    // A chat not written to the disk yet can't be renamed
    const character = context.characters[context.characterId];
    const response = await fetch('/api/characters/chats', { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ avatar_url: character.avatar, simple: true }) });
    const names = response.ok ? Object.values(await response.json()).map(item => String(item?.file_name ?? '').replace(/\.jsonl$/, '')) : [];
    if (!names.includes(current) || names.includes(target) || context.getCurrentChatId() !== current) {
        return;
    }
    await context.renameChat(current, target);
}

function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => renameNow().catch(error => console.error(`[${MODULE}] Renaming the chat failed`, error)), DELAY_MS);
}

export function applyChatName() {
    isOn('chatNamePersona') && schedule();
}

export function initChatName() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, schedule);
    if (eventTypes.PERSONA_CHANGED) {
        eventSource.on(eventTypes.PERSONA_CHANGED, schedule);
    }
}
