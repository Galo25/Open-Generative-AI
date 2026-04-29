import * as muapiProvider from './muapi.js';
import * as replicateProvider from './replicate.js';

export function getActiveProvider() {
    return localStorage.getItem('active_provider') ?? 'muapi';
}

export function setActiveProvider(provider) {
    localStorage.setItem('active_provider', provider);
}

export async function processLipSync(params) {
    const provider = getActiveProvider();
    if (provider === 'replicate') {
        const token = localStorage.getItem('replicate_token');
        if (!token) throw new Error('Replicate token not configured. Go to Settings to add it.');
        return replicateProvider.processLipSync(token, params);
    }
    // default: muapi
    const key = localStorage.getItem('muapi_key');
    if (!key) throw new Error('Muapi API key not configured. Go to Settings to add it.');
    return muapiProvider.processLipSync(key, params);
}
