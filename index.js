// Entry point: loads the extension, and quietly refreshes stale cached files after an update.
// ST's server sends no cache headers, so phone browsers may keep running an old copy of the
// extension for hours after it was updated. When the version in manifest.json changes, every
// file listed there is re-downloaded into the browser cache in the background (no reload),
// so the next time the page is opened the new code runs.
const KEY = 'st_quick_actions_loaded_version';
// Files fetched at a time: a slow server is still starting everything else
const AT_ONCE = 4;

async function refreshCacheIfUpdated() {
    try {
        const base = new URL('./', import.meta.url);
        const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-cache' })).json();
        if (localStorage.getItem(KEY) === manifest.version) {
            return;
        }
        const files = Array.isArray(manifest.cache_files) ? [...manifest.cache_files] : [];
        let failed = 0;
        const worker = async () => {
            while (files.length) {
                const response = await fetch(new URL(files.shift(), base), { cache: 'reload' }).catch(() => null);
                response?.ok || failed++;
            }
        };
        await Promise.all(Array.from({ length: AT_ONCE }, worker));
        // Noted as done only when every file came: otherwise tried again next time
        failed || localStorage.setItem(KEY, manifest.version);
    } catch {
        // Storage or network trouble: the cache simply refreshes on its own later
    }
}

try {
    await import('./main.js');
} finally {
    // Also (above all) when the extension failed to load: an old copy mixed with new files is
    // the usual reason, and fresh files fix it next time
    refreshCacheIfUpdated();
}
