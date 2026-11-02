// Small display options: sharp avatars (the full picture instead of the small thumbnail) and
// hiding the input bar's placeholder text.
import { getSettings } from './settings.js';

// Thumbnail address -> full picture address, per kind of picture
const FULL_PICTURE = { avatar: file => `/characters/${file}`, persona: file => `/User Avatars/${file}` };
const AVATAR_SCOPES = '#chat, #rm_print_characters_block, #rm_group_members, #rm_group_add_members';

let listWatcher = null;

function fullPictureOf(src) {
    const match = src?.match(/^\/thumbnail\?type=(avatar|persona)&file=([^&]+)/);
    return match ? encodeURI(FULL_PICTURE[match[1]](decodeURIComponent(match[2]))) : null;
}

function sharpen(img) {
    const full = fullPictureOf(img.getAttribute('src'));
    if (!full) {
        return;
    }
    // Keep the thumbnail if the full picture can't be loaded
    const thumbnail = img.getAttribute('src');
    img.addEventListener('error', () => img.getAttribute('src') === full && img.setAttribute('src', thumbnail), { once: true });
    img.setAttribute('src', full);
}

/**
 * Chat avatars are swapped right away. Character lists can be long, so a picture there is
 * swapped only once it scrolls into view.
 */
function onImage(img) {
    if (!getSettings().hdAvatars || !fullPictureOf(img.getAttribute('src'))) {
        return;
    }
    if (img.closest('#chat')) {
        sharpen(img);
        return;
    }
    listWatcher ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                listWatcher.unobserve(entry.target);
                getSettings().hdAvatars && sharpen(entry.target);
            }
        }
    });
    listWatcher.observe(img);
}

function scan(root) {
    if (root instanceof HTMLImageElement) {
        onImage(root);
    } else if (root.querySelectorAll) {
        root.querySelectorAll('img[src^="/thumbnail?"]').forEach(onImage);
    }
}

function watchAvatars() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                onImage(mutation.target);
            } else {
                mutation.addedNodes.forEach(scan);
            }
        }
    });
    for (const root of document.querySelectorAll(AVATAR_SCOPES)) {
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
        scan(root);
    }
}

export function applyDisplayTweaks() {
    const settings = getSettings();
    document.body.classList.toggle('stqa_hide_placeholder', settings.hideInputPlaceholder);
    if (settings.hdAvatars) {
        document.querySelectorAll(AVATAR_SCOPES).forEach(scan);
    }
}

export function initDisplayTweaks() {
    watchAvatars();
    applyDisplayTweaks();
}
