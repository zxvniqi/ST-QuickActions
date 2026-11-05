// Small display options: sharp avatars (the full picture instead of the small thumbnail), no
// placeholder text in the input bar, the wand menu as a grid of icons, and a start screen that
// lists recent chats instead of the assistant.
import { isOn } from './settings.js';

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
    // Big card pictures are decoded off the main thread, so scrolling doesn't stall on them
    img.decoding = 'async';
    img.setAttribute('src', full);
}

/**
 * Chat avatars are swapped right away. Character lists can be long, so a picture there is
 * swapped only once it scrolls into view.
 */
function onImage(img) {
    if (!isOn('hdAvatars') || !fullPictureOf(img.getAttribute('src'))) {
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
                isOn('hdAvatars') && sharpen(entry.target);
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

// The placeholder ST puts in the input bar (kept to give back when the option is off)
let placeholder = null;

/** Themes may colour the placeholder with !important, so the text itself is taken out. */
function syncPlaceholder() {
    const input = document.getElementById('send_textarea');
    if (!input) {
        return;
    }
    if (isOn('hideInputPlaceholder')) {
        if (input.getAttribute('placeholder')) {
            placeholder = input.getAttribute('placeholder');
            input.setAttribute('placeholder', '');
        }
    } else if (placeholder !== null && !input.getAttribute('placeholder')) {
        input.setAttribute('placeholder', placeholder);
        placeholder = null;
    }
}

/** Start screen: the recent chats list opened in full (the assistant is hidden by CSS). */
function expandRecentChats() {
    if (!isOn('welcomeRecent')) {
        return;
    }
    const more = document.querySelector('#chat > .welcomePanel button.showMoreChats:not(.rotated)');
    more?.click();
}

const WAND_HOLD_MS = 450;
const WAND_TIP_MS = 1500;

/**
 * Wand menu as icons: holding an icon shows its name in a small label above it (phones show no
 * tooltips), and that press doesn't run the item. A computer shows the tooltip on hover.
 */
function enableWandNames() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return;
    }
    let press = null;
    let tip = null;
    let swallowClick = false;
    const hideTip = () => {
        tip?.remove();
        tip = null;
    };
    const showTip = (item) => {
        hideTip();
        tip = document.createElement('div');
        tip.className = 'stqa_wand_tip';
        // The name as the menu writes it (an item's title may be a longer description)
        tip.textContent = item.textContent.trim() || item.title;
        document.body.append(tip);
        const box = item.getBoundingClientRect();
        const size = tip.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max(4, box.left + box.width / 2 - size.width / 2), window.innerWidth - size.width - 4)}px`;
        tip.style.top = `${Math.max(4, box.top - size.height - 6)}px`;
        setTimeout(hideTip, WAND_TIP_MS);
    };
    const cancel = () => {
        clearTimeout(press?.timer);
        press = null;
    };
    menu.addEventListener('pointerdown', (event) => {
        const item = event.target.closest('.list-group-item');
        if (!isOn('wandGrid') || !item) {
            return;
        }
        swallowClick = false;
        press = { x: event.clientX, y: event.clientY };
        press.timer = setTimeout(() => {
            showTip(item);
            swallowClick = true;
            navigator.vibrate?.(15);
        }, WAND_HOLD_MS);
    });
    menu.addEventListener('pointermove', (event) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
            cancel();
        }
    });
    menu.addEventListener('pointerup', cancel);
    menu.addEventListener('pointercancel', cancel);
    // The press that showed the name doesn't also open the item
    menu.addEventListener('click', (event) => {
        if (swallowClick) {
            swallowClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    menu.addEventListener('contextmenu', (event) => {
        if (isOn('wandGrid') && event.target.closest('.list-group-item')) {
            event.preventDefault();
        }
    });
}

export function applyDisplayTweaks() {
    document.body.classList.toggle('stqa_wand_grid', isOn('wandGrid'));
    if (isOn('wandGrid')) {
        // Icons only: the name stays as the tooltip
        document.querySelectorAll('#extensionsMenu .list-group-item:not([title])').forEach(item => (item.title = item.textContent.trim()));
    }
    document.body.classList.toggle('stqa_welcome_recent', isOn('welcomeRecent'));
    document.body.classList.toggle('stqa_hide_hints', isOn('hideSettingHints'));
    syncPlaceholder();
    expandRecentChats();
    if (isOn('hdAvatars')) {
        document.querySelectorAll(AVATAR_SCOPES).forEach(scan);
    }
}

export function initDisplayTweaks() {
    watchAvatars();
    enableWandNames();
    // ST sets the placeholder again (language, chat changes); the start screen is drawn into the chat
    const input = document.getElementById('send_textarea');
    if (input) {
        new MutationObserver(syncPlaceholder).observe(input, { attributes: true, attributeFilter: ['placeholder'] });
    }
    const chat = document.getElementById('chat');
    if (chat) {
        new MutationObserver(expandRecentChats).observe(chat, { childList: true });
    }
    applyDisplayTweaks();
}
