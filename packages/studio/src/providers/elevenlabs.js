const BASE_URL = 'https://api.elevenlabs.io';

export async function getVoices(apiKey) {
    const response = await fetch(`${BASE_URL}/v1/voices`, {
        headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs voices failed: ${response.status} - ${errText.slice(0, 100)}`);
    }
    const data = await response.json();
    return (data.voices || []).map(v => ({ voice_id: v.voice_id, name: v.name }));
}

export async function generateSpeech(apiKey, { voiceId, text }) {
    if (!text?.trim()) throw new Error('Text is required.');
    if (!voiceId) throw new Error('Voice ID is required.');

    const response = await fetch(`${BASE_URL}/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs TTS failed: ${response.status} - ${errText.slice(0, 100)}`);
    }
    return response.blob();
}

export async function testConnection(apiKey) {
    const response = await fetch(`${BASE_URL}/v1/user`, {
        headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
}
