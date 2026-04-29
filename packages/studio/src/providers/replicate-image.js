import { getModelById } from '../models.js';

const BASE_URL = 'https://api.replicate.com';

// SDXL expects explicit width/height, not aspect_ratio string
const AR_TO_SDXL_SIZE = {
    '1:1':  [1024, 1024],
    '16:9': [1344, 768],
    '9:16': [768, 1344],
    '4:3':  [1152, 896],
    '3:4':  [896, 1152],
    '3:2':  [1248, 832],
    '2:3':  [832, 1248],
    '21:9': [1536, 640],
};

function parseReplicateError(text) {
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
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Token ${token}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait=30',
        },
        body: JSON.stringify({ input }),
        signal,
    });
    if (!response.ok) {
        const errText = await response.text();
        if (response.status === 401) throw new Error('Replicate token is invalid. Check it in Settings.');
        if (response.status === 404) throw new Error(`Replicate model not found: ${modelSlug}`);
        throw new Error(`Replicate: ${parseReplicateError(errText)}`);
    }
    return response.json();
}

async function pollForResult(predictionId, token, signal) {
    const pollUrl = `${BASE_URL}/v1/predictions/${predictionId}`;
    const maxAttempts = 180;
    const interval = 2000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new Error('Generation cancelled.');
        await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, interval);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Generation cancelled.')); }, { once: true });
        });
        if (signal?.aborted) throw new Error('Generation cancelled.');
        const response = await fetch(pollUrl, {
            headers: { 'Authorization': `Token ${token}` },
            signal,
        });
        if (!response.ok) {
            if (response.status >= 500) continue;
            throw new Error(`Replicate poll error: ${response.status}`);
        }
        const data = await response.json();
        const status = data.status;
        if (status === 'succeeded') {
            const output = Array.isArray(data.output) ? data.output[0] : data.output;
            const url = typeof output === 'object' ? output?.url?.() ?? String(output) : output;
            return { url };
        }
        if (status === 'failed' || status === 'canceled') {
            const logTail = data.logs ? data.logs.trim().split('\n').slice(-3).join(' | ') : '';
            throw new Error(`Replicate failed: ${data.error || logTail || 'Unknown error'}`);
        }
    }
    throw new Error('Replicate generation timed out.');
}

function buildFluxInput(params) {
    const input = {
        prompt: params.prompt,
        num_outputs: 1,
        output_format: 'webp',
        output_quality: 80,
    };
    if (params.aspect_ratio) input.aspect_ratio = params.aspect_ratio;
    if (params.seed && params.seed !== -1) input.seed = params.seed;
    return input;
}

function buildSdxlInput(params) {
    const [width, height] = AR_TO_SDXL_SIZE[params.aspect_ratio] || [1024, 1024];
    return {
        prompt: params.prompt,
        width,
        height,
        num_outputs: 1,
        num_inference_steps: 20,
        guidance_scale: 7.5,
        scheduler: 'K_EULER',
        ...(params.seed && params.seed !== -1 ? { seed: params.seed } : {}),
    };
}

export async function generateImage(token, params) {
    const modelInfo = getModelById(params.model);
    const replicateId = modelInfo?.replicateId;
    if (!replicateId) throw new Error(`Model "${params.model}" is not available on Replicate. Switch to Muapi in Settings.`);

    let input;
    if (replicateId === 'stability-ai/sdxl') {
        input = buildSdxlInput(params);
    } else {
        // All FLUX variants use the same input shape
        input = buildFluxInput(params);
    }

    const prediction = await createPrediction(token, replicateId, input, params.signal);

    if (prediction.status === 'succeeded') {
        const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        const url = typeof output === 'object' ? output?.url?.() ?? String(output) : output;
        return { url, id: prediction.id };
    }

    return pollForResult(prediction.id, token, params.signal);
}
