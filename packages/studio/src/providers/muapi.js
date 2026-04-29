import { getLipSyncModelById } from '../models.js';

const BASE_URL = 'https://api.muapi.ai';

async function pollForResult(requestId, key, maxAttempts = 900, interval = 2000, { signal, onPollStatus } = {}) {
    const pollUrl = `${BASE_URL}/api/v1/predictions/${requestId}/result`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new Error('Generation cancelled.');
        await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, interval);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Generation cancelled.')); }, { once: true });
        });
        if (signal?.aborted) throw new Error('Generation cancelled.');
        try {
            const response = await fetch(pollUrl, {
                headers: { 'Content-Type': 'application/json', 'x-api-key': key },
                signal,
            });
            if (!response.ok) {
                const errText = await response.text();
                if (response.status >= 500) continue;
                throw new Error(`Poll Failed: ${response.status} - ${errText.slice(0, 100)}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (onPollStatus) onPollStatus({ attempt, maxAttempts, status, requestId });
            if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
            if (status === 'failed' || status === 'error') throw new Error(`Generation failed: ${data.error || 'Unknown error'}`);
        } catch (error) {
            if (error.message === 'Generation cancelled.' || error.name === 'AbortError') throw new Error('Generation cancelled.');
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Generation timed out after polling.');
}

export async function processLipSync(apiKey, params) {
    const modelInfo = getLipSyncModelById(params.model);
    const endpoint = modelInfo?.endpoint || params.model;
    const url = `${BASE_URL}/api/v1/${endpoint}`;

    const payload = {};
    if (params.audio_url) payload.audio_url = params.audio_url;
    if (params.image_url) payload.image_url = params.image_url;
    if (params.video_url) payload.video_url = params.video_url;
    if (params.prompt) payload.prompt = params.prompt;
    if (params.resolution) payload.resolution = params.resolution;
    if (params.seed !== undefined && params.seed !== -1) payload.seed = params.seed;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: params.signal,
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
    }
    const submitData = await response.json();
    const requestId = submitData.request_id || submitData.id;
    if (!requestId) return submitData;
    if (params.onRequestId) params.onRequestId(requestId);

    const result = await pollForResult(requestId, apiKey, 900, 2000, {
        signal: params.signal,
        onPollStatus: params.onPollStatus,
    });
    const outputUrl = result.outputs?.[0] || result.url || result.output?.url;
    return { ...result, url: outputUrl };
}

export async function testConnection(apiKey) {
    const response = await fetch(`${BASE_URL}/api/v1/account/balance`, {
        headers: { 'x-api-key': apiKey },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
}
