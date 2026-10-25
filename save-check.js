// Detects settings that never reached the server, and a one-tap save diagnosis.
// ST's server answers HTTP 200 even when writing settings.json fails (it sends the error as
// the body), so ST shows no error. Here a stamp travels with every save and is compared on load.
import * as script from '../../../../script.js';
import { MODULE, getSettings } from './settings.js';

const STAMP_KEY = `${MODULE}_save_stamp`;
const DEVICE_KEY = `${MODULE}_device_id`;
const TITLE = '편의성 모음';
const MAX_LISTED_DIFFS = 8;
// Friendly names for settings people commonly report as "turning back on"
const SETTING_LABELS = Object.freeze({
    allow_name1_display: '응답에 {{user}}: 표시',
    allow_name2_display: '응답에 {{char}}: 표시',
});

let deviceId = null;

/** A random id for this browser, so the diagnosis can tell which device saved last. */
function getDeviceId() {
    if (deviceId) {
        return deviceId;
    }
    try {
        deviceId = localStorage.getItem(DEVICE_KEY);
        if (!deviceId) {
            deviceId = Math.random().toString(36).slice(2, 10);
            localStorage.setItem(DEVICE_KEY, deviceId);
        }
    } catch {
        deviceId = 'unknown';
    }
    return deviceId;
}

function readLocalStamp() {
    try {
        return Number(localStorage.getItem(STAMP_KEY)) || 0;
    } catch {
        return 0;
    }
}

function writeLocalStamp(stamp) {
    try {
        localStorage.setItem(STAMP_KEY, String(stamp));
    } catch {
        // Storage blocked: the startup check is simply skipped
    }
}

/** Called on every settings edit; the stamp is saved together with ST's next settings save. */
export function stampSettingsEdit() {
    const settings = getSettings();
    settings.saveStamp = Date.now();
    settings.saveDevice = getDeviceId();
}

/** Settings whose value on the server differs from what is applied right now. */
function diffSettings(serverPowerUser, livePowerUser) {
    return Object.keys(livePowerUser)
        .filter(key => JSON.stringify(serverPowerUser?.[key]) !== JSON.stringify(livePowerUser[key]))
        .map(key => SETTING_LABELS[key] ?? key);
}

/** ST reported a successful save: remember which edit this browser believes was saved. */
export function rememberSavedStamp() {
    writeLocalStamp(getSettings().saveStamp ?? 0);
}

/** On startup: a newer stamp in this browser than on the server means a save got lost. */
export function checkLastSaveOnLoad() {
    const local = readLocalStamp();
    const server = getSettings().saveStamp ?? 0;
    if (local > server) {
        toastr.warning('마지막으로 바꾼 설정이 서버에 저장되지 않았어요. 마법봉 → 편의성 모음 → 저장 진단을 눌러 원인을 확인해 보세요.', TITLE, { timeOut: 15000 });
    }
}

async function readServerSettings() {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: JSON.stringify({}),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return JSON.parse(data.settings);
}

/** Runs ST's real save while capturing the server's answer (ST itself ignores the body). */
async function saveAndCaptureResponse() {
    const originalFetch = window.fetch;
    let answer = null;
    window.fetch = async function (url, ...rest) {
        const response = await originalFetch.call(this, url, ...rest);
        if (String(url).includes('/api/settings/save')) {
            answer = await response.clone().json().catch(() => null);
        }
        return response;
    };
    try {
        await script.saveSettings();
    } finally {
        window.fetch = originalFetch;
    }
    return answer;
}

async function checkBrowserStorage() {
    let localStorageWorks = false;
    try {
        localStorage.setItem(`${MODULE}_probe`, '1');
        localStorageWorks = localStorage.getItem(`${MODULE}_probe`) === '1';
        localStorage.removeItem(`${MODULE}_probe`);
    } catch {
        // Blocked by the browser
    }
    const persisted = await navigator.storage?.persisted?.().catch(() => null) ?? null;
    return { localStorageWorks, persisted };
}

/** @param {boolean|'info'} ok */
const line = (ok, text) => `<li>${ok === 'info' ? 'ℹ️' : ok ? '✅' : '❌'} ${text}</li>`;

/**
 * @param {() => Promise<number>} countOtherTabs Provided by the save guard, which owns the tab channel
 */
export async function runSaveDiagnosis(countOtherTabs) {
    const { Popup, POPUP_TYPE, loader } = SillyTavern.getContext();
    const handle = loader?.show?.({ message: '저장 상태를 확인하는 중...', blocking: true });
    const items = [];
    const advice = [];
    try {
        // Before saving anything: what the server holds vs what is applied in this page
        const before = await readServerSettings();
        const lastDevice = before?.extension_settings?.[MODULE]?.saveDevice;
        if (lastDevice) {
            const fromHere = lastDevice === getDeviceId();
            items.push(line(fromHere ? true : 'info', fromHere
                ? '설정을 마지막으로 바꾼 곳은 이 기기(브라우저)예요.'
                : '설정을 마지막으로 바꾼 곳은 다른 기기나 다른 브라우저예요.'));
            if (!fromHere) {
                advice.push('다른 기기(PC 등)나 다른 브라우저에서 실리가 열려 있으면, 거기에 남아 있는 예전 설정이 저장되면서 덮어써요. 다른 곳의 실리 탭을 닫거나 새로고침해 주세요.');
            }
        }
        const diffs = diffSettings(before?.power_user, SillyTavern.getContext().powerUserSettings ?? {});
        items.push(line(diffs.length === 0, diffs.length === 0
            ? '서버에 저장된 설정과 지금 적용된 설정이 같아요.'
            : `서버에 저장된 값과 지금 적용된 값이 다른 설정: ${diffs.slice(0, MAX_LISTED_DIFFS).join(', ')}${diffs.length > MAX_LISTED_DIFFS ? ` 외 ${diffs.length - MAX_LISTED_DIFFS}개` : ''}`));
        if (diffs.length > 0) {
            advice.push('새로고침 직후인데도 값이 다르다면, 서버에는 제대로 저장돼 있는데 다른 확장·스크립트(예: 주점/酒馆 도우미 스크립트, 프리셋 자동 적용 확장)가 켤 때 값을 바꾸는 거예요. 확장을 하나씩 꺼보며 범인을 찾아보세요. (방금 설정을 바꾼 직후라면 아직 저장 전이라 다를 수 있어요.)');
        }

        const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        getSettings().diagToken = token;

        const answer = await saveAndCaptureResponse();
        const serverAccepted = answer?.result === 'ok';
        items.push(line(serverAccepted, serverAccepted
            ? '서버가 설정 저장을 받아들였어요.'
            : `서버가 설정 파일을 쓰지 못했어요. (${answer ? JSON.stringify(answer).slice(0, 120) : '응답 없음'})`));
        if (!serverAccepted) {
            advice.push('SillyTavern이 설치된 폴더에 쓰기 권한이 없거나 저장 공간이 부족한 경우예요. Termux라면 실리 폴더를 내부 저장소(/sdcard)가 아닌 Termux 홈 폴더(~)에 두는 게 안전해요.');
        }

        const stored = await readServerSettings();
        const readBack = stored?.extension_settings?.[MODULE]?.diagToken === token;
        items.push(line(readBack, readBack
            ? '다시 읽어봐도 방금 저장한 값이 그대로 있어요.'
            : '다시 읽으면 방금 저장한 값이 없어요.'));
        if (serverAccepted && !readBack) {
            advice.push('저장은 됐다는데 다른 값이 읽혀요. 다른 기기·탭이 바로 덮어썼거나, 서버가 다른 사용자 폴더를 보고 있을 수 있어요.');
        }

        const otherTabs = await countOtherTabs();
        items.push(line(otherTabs === 0, otherTabs === 0
            ? '이 브라우저에 다른 SillyTavern 탭은 없어요.'
            : `이 브라우저에 SillyTavern 탭이 ${otherTabs}개 더 열려 있어요.`));
        if (otherTabs > 0) {
            advice.push('오래된 탭이 저장할 때 예전 설정으로 덮어써요. 한 탭만 남겨주세요.');
        }

        const browser = await checkBrowserStorage();
        items.push(line(browser.localStorageWorks, browser.localStorageWorks
            ? '브라우저 저장소가 정상이에요.'
            : '브라우저 저장소(localStorage)가 막혀 있어요.'));
        items.push(line(browser.persisted ? true : 'info', browser.persisted
            ? '브라우저가 이 사이트 데이터를 지우지 않도록 보호 중이에요.'
            : '브라우저가 공간이 부족하면 이 사이트 데이터를 지울 수 있어요. (실리 설정 자체는 서버에 있어서 영향 없음)'));

        if (advice.length === 0) {
            advice.push('저장 경로는 정상이에요. 설정을 바꾼 뒤 새로고침하고 곧바로 다시 진단해 보면, 되돌아가는 원인이 위 항목에 나타나요.');
        }
    } catch (error) {
        console.error(`[${MODULE}] Save diagnosis failed`, error);
        items.push(line(false, `서버에 연결하지 못했어요. (${String(error.message ?? error)})`));
        advice.push('서버(실리)가 꺼졌거나 연결이 끊겼어요. Termux라면 Termux가 백그라운드에서 종료되지 않게 배터리 최적화에서 빼주세요.');
    } finally {
        delete getSettings().diagToken;
        await handle?.hide?.();
    }

    const html = `
        <h3>저장 진단</h3>
        <small class="stqa_hint">정확히 보려면: 되돌아가는 설정을 바꿈 → 새로고침 → 바로 이 진단 실행</small>
        <ul class="stqa_diag_list">${items.join('')}</ul>
        <b>추천</b>
        <ul class="stqa_diag_list">${advice.map(text => `<li>${text}</li>`).join('')}</ul>`;
    await new Popup(html, POPUP_TYPE.TEXT, '', { okButton: '닫기', leftAlign: true }).show();
}
