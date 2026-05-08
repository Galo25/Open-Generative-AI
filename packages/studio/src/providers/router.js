import * as muapiProvider from './muapi.js';
import * as replicateProvider from './replicate.js';
import * as replicateImageProvider from './replicate-image.js';
import { generateImage as muapiGenerateImage, generateI2I as muapiGenerateI2I } from '../muapi.js';
import { getLipSyncModelById } from '../models.js';

export function getActiveProvider() {
    return localStorage.getItem('active_provider') ?? 'muapi';
}

export function setActiveProvider(provider) {
    localStorage.setItem('active_provider', provider);
}

export async function generateImage(params) {
    const provider = getActiveProvider();
    if (provider === 'replicate') {
        const token = localStorage.getItem('replicate_token');
        if (!token) throw new Error('Replicate token not configured. Go to Settings to add it.');
        return replicateImageProvider.generateImage(token, params);
    }
    const key = localStorage.getItem('muapi_key');
    if (!key) throw new Error('Muapi API key not configured. Go to Settings to add it.');
    return muapiGenerateImage(key, params);
}

export async function generateI2I(params) {
    const provider = getActiveProvider();
    if (provider === 'replicate') {
        throw new Error('Image-to-image is not yet supported on Replicate. Switch to Muapi in Settings.');
    }
    const key = localStorage.getItem('muapi_key');
    if (!key) throw new Error('Muapi API key not configured. Go to Settings to add it.');
    return muapiGenerateI2I(key, params);
}

export async function processLipSync(params) {
    // Route based on the model's own provider field, not the global active_provider.
    // This lets Replicate-native models always call Replicate regardless of settings.
    const modelInfo = getLipSyncModelById(params.model);
    const modelProvider = modelInfo?.provider ?? 'Muapi';

    if (modelProvider === 'Replicate') {
        const token = localStorage.getItem('replicate_token');
        if (!token) throw new Error('Replicate token not configured. Go to Settings to add it.');
        return replicateProvider.processLipSync(token, params);
    }
    // Fallback: also honour the global active_provider switch for Muapi models
    if (getActiveProvider() === 'replicate') {
        const token = localStorage.getItem('replicate_token');
        if (!token) throw new Error('Replicate token not configured. Go to Settings to add it.');
        return replicateProvider.processLipSync(token, params);
    }
    const key = localStorage.getItem('muapi_key');
    if (!key) throw new Error('Muapi API key not configured. Go to Settings to add it.');
    return muapiProvider.processLipSync(key, params);
}
