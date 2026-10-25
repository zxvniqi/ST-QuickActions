// A select box whose options unfold right below it (scrolling inside when long),
// instead of the phone's native option popup.

/**
 * @param {{ options: { value: string, label: string }[], value: string, onChange: (value: string) => void }} config
 * @returns {HTMLElement}
 */
export function createInlineSelect({ options, value, onChange }) {
    const root = document.createElement('div');
    root.className = 'stqa_select';
    root.innerHTML = `
        <div class="stqa_select_box text_pole" tabindex="0"><span></span><i class="fa-solid fa-chevron-down"></i></div>
        <div class="stqa_select_list" hidden></div>`;
    const box = root.querySelector('.stqa_select_box');
    const label = box.querySelector('span');
    const list = root.querySelector('.stqa_select_list');

    for (const option of options) {
        const item = document.createElement('div');
        item.className = 'stqa_select_item';
        item.dataset.value = option.value;
        item.textContent = option.label;
        list.append(item);
    }

    const select = (next) => {
        value = next;
        label.textContent = options.find(option => option.value === value)?.label ?? '';
        for (const item of list.children) {
            item.classList.toggle('stqa_selected', item.dataset.value === value);
        }
    };
    // A tap outside closes the list; scrolling the page (no click) keeps it open
    const onOutside = (event) => {
        if (!root.contains(event.target)) {
            setOpen(false);
        }
    };
    const setOpen = (open) => {
        list.hidden = !open;
        root.classList.toggle('stqa_open', open);
        open ? document.addEventListener('click', onOutside, true) : document.removeEventListener('click', onOutside, true);
    };

    box.addEventListener('click', () => setOpen(list.hidden));
    list.addEventListener('click', (event) => {
        const item = event.target.closest('.stqa_select_item');
        if (!item) {
            return;
        }
        select(item.dataset.value);
        setOpen(false);
        onChange(value);
    });

    select(value);
    return root;
}
