// Entry point: refreshes stale cached files after an update, then loads the extension.
// ST's server sends no cache headers, so phone browsers may keep running an old copy of the
// extension for hours after it was updated. When the version in manifest.json changes, every
// file listed there is re-downloaded into the browser cache and the page reloads once.
const KEY = 'st_quick_actions_loaded_version';

async function refreshCacheIfUpdated() {
    try {
        const base = new URL('./', import.meta.url);
        const manifest = await (await fetch(new URL('manifest.json', base), { cache: 'no-cache' })).json();
        if (localStorage.getItem(KEY) === manifest.version) {
            return false;
        }
        localStorage.setItem(KEY, manifest.version);
        // At most one reload per tab session, even if this browser keeps wiping localStorage
        if (sessionStorage.getItem(KEY) === manifest.version) {
            return false;
        }
        sessionStorage.setItem(KEY, manifest.version);
        const files = Array.isArray(manifest.cache_files) ? manifest.cache_files : [];
        await Promise.all(files.map(file => fetch(new URL(file, base), { cache: 'reload' })));
        location.reload();
        return true;
    } catch {
        // Storage or network trouble: just run whatever is loaded
        return false;
    }
}

if (!(await refreshCacheIfUpdated())) {
    await import('./main.js');
}
