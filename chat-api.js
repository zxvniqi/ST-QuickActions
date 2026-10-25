// Server calls for one character's chat files (the same endpoints ST's own chat manager uses).
import { MODULE } from './settings.js';

const JSONL = /\.jsonl$/;

function post(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify(body),
    });
}

/** Normalizes both list endpoints to one shape, newest first. */
function normalizeChats(items, { countKey, previewKey }) {
    const { timestampToMoment } = SillyTavern.getContext();
    return items
        .filter(item => item?.file_name)
        .map(item => ({
            name: item.file_name.replace(JSONL, ''),
            size: item.file_size ?? '',
            count: item[countKey] ?? 0,
            preview: item[previewKey] ?? '',
            moment: timestampToMoment(item.last_mes),
        }))
        .sort((a, b) => (b.moment.valueOf() || 0) - (a.moment.valueOf() || 0));
}

/**
 * Without a query the plain list is used: the server reads the files in parallel.
 * The search endpoint reads them one by one, so it is only used for an actual search.
 * @returns {Promise<object[]|null>} null on failure
 */
export async function listChats(avatar, query = '') {
    try {
        const response = query
            ? await post('/api/chats/search', { query, avatar_url: avatar, group_id: null })
            : await post('/api/characters/chats', { avatar_url: avatar });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (data?.error) {
            return [];
        }
        const items = Array.isArray(data) ? data : Object.values(data);
        return query
            ? normalizeChats(items, { countKey: 'message_count', previewKey: 'preview_message' })
            : normalizeChats(items, { countKey: 'chat_items', previewKey: 'mes' });
    } catch (error) {
        console.error(`[${MODULE}] Could not load chats`, error);
        return null;
    }
}

/** Saves which chat opens for the character, the same way ST does. */
export async function setActiveChat(character, chatName) {
    character.chat = chatName;
    try {
        const response = await post('/api/characters/merge-attributes', { avatar: character.avatar, chat: chatName });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn(`[${MODULE}] Could not persist active chat`, error);
    }
}

/** @returns {Promise<string>} The final (possibly sanitized) name */
export async function renameChat(character, oldName, newName) {
    const response = await post('/api/chats/rename', {
        is_group: false,
        avatar_url: character.avatar,
        original_file: `${oldName}.jsonl`,
        renamed_file: `${newName}.jsonl`,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
        throw new Error('Rename failed');
    }
    const finalName = data.sanitizedFileName || newName;
    if (character.chat === oldName) {
        await setActiveChat(character, finalName);
    }
    const { eventSource, eventTypes } = SillyTavern.getContext();
    await eventSource.emit(eventTypes.CHAT_RENAMED, {
        avatarId: character.avatar,
        groupId: null,
        oldFileName: `${oldName}.jsonl`,
        newFileName: `${finalName}.jsonl`,
    });
    return finalName;
}

/** Deletes a chat; if it was the one that opens by default, the newest remaining chat takes over. */
export async function deleteChat(character, name) {
    const response = await post('/api/chats/delete', { chatfile: `${name}.jsonl`, avatar_url: character.avatar });
    if (!response.ok) {
        throw new Error('Delete failed');
    }
    if (character.chat === name) {
        const remaining = await listChats(character.avatar);
        const { humanizedDateTime } = SillyTavern.getContext();
        await setActiveChat(character, remaining?.[0]?.name ?? `${character.name} - ${humanizedDateTime()}`);
    }
    const { eventSource, eventTypes } = SillyTavern.getContext();
    await eventSource.emit(eventTypes.CHAT_DELETED, name);
}

/** @param {'jsonl'|'txt'} format */
export async function exportChat(character, name, format) {
    const fileName = `${name}.${format}`;
    const response = await post('/api/chats/export', {
        is_group: false,
        avatar_url: character.avatar,
        file: `${name}.jsonl`,
        exportfilename: fileName,
        format,
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.message || 'Export failed');
    }
    const blob = new Blob([data.result], { type: format === 'txt' ? 'text/plain' : 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** @returns {Promise<string[]>} Names of the imported chats */
export async function importChats(character, files) {
    const { getRequestHeaders, name1 } = SillyTavern.getContext();
    const imported = [];
    for (const file of files) {
        const format = file.name.match(/\.(\w+)$/)?.[1]?.toLowerCase();
        if (!['json', 'jsonl'].includes(format)) {
            toastr.warning(`${file.name}: JSON / JSONL 파일만 불러올 수 있어요.`, '편의성 모음');
            continue;
        }
        const form = new FormData();
        form.set('avatar', file);
        form.set('file_type', format);
        form.set('avatar_url', character.avatar);
        form.set('character_name', character.name);
        form.set('user_name', name1);
        const response = await fetch('/api/chats/import', {
            method: 'POST',
            body: form,
            headers: getRequestHeaders({ omitContentType: true }),
            cache: 'no-cache',
        });
        if (response.ok) {
            const data = await response.json();
            imported.push(...(data?.fileNames ?? []).map(fileName => fileName.replace(JSONL, '')));
        }
    }
    return imported;
}
