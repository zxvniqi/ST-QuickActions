// Entry point: loads the extension, and quietly refreshes stale cached files after an update.
// ST's server sends no cache headers, so phone browsers may keep running an old copy of the
// extension for hours after it was updated. When the version in manifest.json changes, every
// file listed there is re-downloaded into the browser cache in the background (no reload),
// so the next time the page is opened the new code runs.
const KEY = 'st_quick_actions_loaded_version';

async function refreshCacheIfUpdated() {
    try {
        const base = new URL('./', import.meta.url);
        const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-cache' })).json();
        if (localStorage.getItem(KEY) === manifest.version) {
            return;
        }
        const files = Array.isArray(manifest.cache_files) ? manifest.cache_files : [];
        await Promise.all(files.map(file => fetch(new URL(file, base), { cache: 'reload' })));
        localStorage.setItem(KEY, manifest.version);
    } catch {
        // Storage or network trouble: the cache simply refreshes on its own later
    }
}

await import('./main.js');
refreshCacheIfUpdated();
