// Connection profiles and Vertex AI service accounts. Extensions send side requests (translations,
// summaries, directions...) through a connection profile; for Vertex AI, ST leaves out how to sign
// in, so the server takes it for an API key ("express") and a service account fails, while the
// connection in use works. The sign-in (with its project and, when the profile names none, its
// region) is filled in from the Vertex AI settings in use, for every extension's requests.
import { MODULE, isOn } from './settings.js';

let openai = null;

/**
 * The Vertex AI sign-in the connection in use has, for a profile's request. Only a service account
 * ("full"): with an API key the server signs in that way already, as the profile expects.
 */
function vertexSignIn(profile) {
    const settings = openai?.oai_settings;
    if (settings?.vertexai_auth_mode !== 'full') {
        return {};
    }
    return {
        vertexai_auth_mode: settings.vertexai_auth_mode,
        vertexai_express_project_id: settings.vertexai_express_project_id,
        ...(profile['api-url'] ? {} : { vertexai_region: settings.vertexai_region }),
    };
}

export async function initVertexProfileFix() {
    const service = SillyTavern.getContext().ConnectionManagerRequestService;
    if (typeof service?.sendRequest !== 'function') {
        return;
    }
    try {
        openai = await import('../../../openai.js');
    } catch (error) {
        console.warn(`[${MODULE}] Vertex AI profile fix is off`, error);
        return;
    }
    const original = service.sendRequest;
    service.sendRequest = function (profileId, prompt, maxTokens, custom, overridePayload, ...rest) {
        try {
            const profile = SillyTavern.getContext().extensionSettings.connectionManager?.profiles?.find(item => item.id === profileId);
            const signIn = isOn('vertexProfileFix') && profile?.api === 'vertexai' ? vertexSignIn(profile) : {};
            if (Object.keys(signIn).length) {
                // What the caller passed itself still wins
                return original.call(this, profileId, prompt, maxTokens, custom, { ...signIn, ...overridePayload }, ...rest);
            }
        } catch {
            // The request goes as it was
        }
        return original.apply(this, arguments);
    };
}
