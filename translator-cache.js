// LLM Translator keeps "original -> translation" in the browser (IndexedDB) and, in automatic
// mode, translates a message again whenever its current original isn't there. Edits that keep
// the translation write it there too, so it stays (and an edited translation isn't replaced by
// the old one later).
import { MODULE } from './settings.js';

const DB_NAME = 'LLMtranslatorDB';
const STORE_NAME = 'translations';
const SETTINGS_KEY = 'llm-translator-custom';

/** The translator's database, only if the translator made one (opening it otherwise would create it). */
async function openTranslatorDb() {
    const known = await indexedDB.databases?.();
    if (!known?.some(db => db.name === DB_NAME)) {
        return null;
    }
    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME);
        request.onsuccess = () => {
            const db = request.result;
            db.objectStoreNames.contains(STORE_NAME) ? resolve(db) : (db.close(), resolve(null));
        };
        request.onerror = () => resolve(null);
    });
}

/** Records `translation` as the translation of `original` (adds it, or updates the stored one). */
export async function rememberTranslation(original, translation) {
    if (!original || !translation) {
        return;
    }
    try {
        const db = await openTranslatorDb();
        if (!db) {
            return;
        }
        const settings = SillyTavern.getContext().extensionSettings[SETTINGS_KEY] ?? {};
        // The translator writes Korean time as an ISO string; same here
        const date = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const lookup = store.index('originalText').get(original);
            lookup.onsuccess = () => {
                const record = lookup.result;
                const entry = { translation, provider: settings.llm_provider, model: settings.llm_model, date };
                record ? store.put({ ...record, ...entry }) : store.add({ originalText: original, ...entry });
            };
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    } catch (error) {
        console.warn(`[${MODULE}] Couldn't update the translator's saved translations`, error);
    }
}
