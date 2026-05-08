import { getLipSyncModelById } from '../models.js';

const BASE_URL = '/api/replicate';

// SadTalker: portrait image + audio → talking video
const SADTALKER_MODEL = 'zsxkib/sadtalker';
// Wav2Lip: video + audio → lipsync video
const WAV2LIP_MODEL = 'devxpy/wav2lip';
// Replicate-native lipsync models
const P_VIDEO_AVATAR_MODEL   = 'prunaai/p-video-avatar';
const MULTITALK_MODEL        = 'zsxkib/multitalk';
const HEYGEN_PRECISION_MODEL = 'heygen/lipsync-precision';
const SYNC_2_PRO_MODEL       = 'sync/lipsync-2-pro';

async function pollForResult(predictionId, token, { signal, onPollStatus } = {}) {
    const pollUrl = `${BASE_URL}/v1/predictions/${predictionId}`;
    const maxAttempts = 900;
    const interval = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new Error('Generation cancelled.');
        await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, interval);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Generation cancelled.')); }, { once: true });
        });
        if (signal?.aborted) throw new Error('Generation cancelled.');
        try {
            const response = await fetch(pollUrl, {
                headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
                signal,
            });
            if (!response.ok) {
                if (response.status >= 500) continue;
                const errText = await response.text();
                throw new Error(`Poll Failed: ${response.status} - ${errText.slice(0, 100)}`);
            }
            const data = await response.json();
            const status = data.status?.toLowerCase();
            if (onPollStatus) onPollStatus({ attempt, maxAttempts, status, requestId: predictionId });
            if (status === 'succeeded') {
                const url = Array.isArray(data.output) ? data.output[0] : data.output;
                return { ...data, url };
            }
            if (status === 'failed' || status === 'canceled') {
                const logLines = data.logs ? data.logs.trim().split('\n') : [];
                const logTail = logLines.slice(-5).join(' | ');
                const msg = data.error || logTail || 'Unknown error';
                // Log full details for debugging
                console.error('[Replicate] Prediction failed:', {
                    id: predictionId,
                    error: data.error,
                    logs: logLines.slice(-10).join('\n'),
                });
                throw new Error(`Generation failed: ${msg}`);
            }
        } catch (error) {
            if (error.message === 'Generation cancelled.' || error.name === 'AbortError') throw new Error('Generation cancelled.');
            if (attempt === maxAttempts) throw error;
        }
    }
    throw new Error('Generation timed out after polling.');
}

function parseReplicateError(status, text) {
    try {
        const j = JSON.parse(text);
        return j.detail || j.error || text.slice(0, 150);
    } catch {
        return text.slice(0, 150);
    }
}

async function createPrediction(token, modelSlug, input, signal) {
    const [owner, name] = modelSlug.split('/');
    const url = `${BASE_URL}/v1/models/${owner}/${name}/predictions`;
    console.log('[Replicate] Creating prediction:', modelSlug, JSON.stringify(input, null, 2));
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json', 'Prefer': 'wait=5' },
        body: JSON.stringify({ input }),
        signal,
    });
    if (!response.ok) {
        const errText = await response.text();
        if (response.status === 401) throw new Error('Replicate token is invalid. Check it in Settings.');
        if (response.status === 404) throw new Error(`Replicate model not found: ${modelSlug}`);
        throw new Error(`Replicate: ${parseReplicateError(response.status, errText)}`);
    }
    return response.json();
}

export async function processLipSync(token, params) {
    const modelInfo = getLipSyncModelById(params.model);
    const replicateId = modelInfo?.replicateId;
    if (!replicateId) throw new Error(`No Replicate model mapped for: ${params.model}`);

    let input;
    if (replicateId === SADTALKER_MODEL) {
        // portrait image + audio → video
        if (!params.image_url) throw new Error('SadTalker requires an image URL.');
        if (!params.audio_url) throw new Error('SadTalker requires an audio URL.');
        input = {
            source_image: params.image_url,
            driven_audio: params.audio_url,
            preprocess: 'full',
            still: false,
            use_enhancer: false,
        };
    } else if (replicateId === WAV2LIP_MODEL) {
        // video + audio → lipsync
        if (!params.video_url) throw new Error('Wav2Lip requires a video URL.');
        if (!params.audio_url) throw new Error('Wav2Lip requires an audio URL.');
        input = {
            face: params.video_url,
            audio: params.audio_url,
        };
    } else if (replicateId === P_VIDEO_AVATAR_MODEL) {
        // portrait image + audio → talking video (PrunaAI)
        if (!params.image_url) throw new Error('P-Video Avatar requires an image URL.');
        if (!params.audio_url) throw new Error('P-Video Avatar requires an audio URL.');
        input = {
            image:      params.image_url,
            audio:      params.audio_url,
            resolution: params.resolution || '720p',
        };
    } else if (replicateId === MULTITALK_MODEL) {
        // portrait image + audio → multi-person talking video
        if (!params.image_url) throw new Error('MultiTalk requires an image URL.');
        if (!params.audio_url) throw new Error('MultiTalk requires an audio URL.');
        input = {
            image:       params.image_url,
            first_audio: params.audio_url,
            prompt:      params.prompt || 'The person is talking naturally.',
            // 81 frames ≈ 3s at ~25fps, max 201 frames ≈ 8s
            num_frames:  81,
        };
    } else if (replicateId === HEYGEN_PRECISION_MODEL) {
        // video + audio → lipsync (HeyGen)
        if (!params.video_url) throw new Error('HeyGen Lipsync Precision requires a video URL.');
        if (!params.audio_url) throw new Error('HeyGen Lipsync Precision requires an audio URL.');
        input = {
            video_url: params.video_url,
            audio_url: params.audio_url,
        };
    } else if (replicateId === SYNC_2_PRO_MODEL) {
        // video + audio → lipsync (Sync Labs)
        if (!params.video_url) throw new Error('Sync Lipsync 2 Pro requires a video URL.');
        if (!params.audio_url) throw new Error('Sync Lipsync 2 Pro requires an audio URL.');
        input = {
            video: params.video_url,
            audio: params.audio_url,
        };
    } else {
        throw new Error(`Unknown Replicate model: ${replicateId}`);
    }

    const prediction = await createPrediction(token, replicateId, input, params.signal);
    if (params.onRequestId) params.onRequestId(prediction.id);

    // If already succeeded (Prefer: wait=5 resolved it immediately)
    if (prediction.status === 'succeeded') {
        const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        return { ...prediction, url };
    }

    return pollForResult(prediction.id, token, {
        signal: params.signal,
        onPollStatus: params.onPollStatus,
    });
}

export async function testConnection(token) {
    const response = await fetch(`${BASE_URL}/v1/account`, {
        headers: { 'Authorization': `Token ${token}` },
    });
    if (response.status === 401) throw new Error('Invalid token — check your Replicate API token.');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
}

/**
 * Returns basic Replicate account info { username, name }.
 * Replicate has no public billing endpoint so we show the username
 * to confirm which account is active.
 */
export async function getReplicateAccount(token) {
    const response = await fetch(`${BASE_URL}/v1/account`, {
        headers: { 'Authorization': `Token ${token}` },
    });
    if (!response.ok) throw new Error(`Replicate account fetch failed: ${response.status}`);
    return response.json(); // { type, username, name, github_url, ... }
}
