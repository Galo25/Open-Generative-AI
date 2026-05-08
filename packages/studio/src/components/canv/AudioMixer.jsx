"use client";

import { useState, useRef, useEffect, useCallback } from 'react';

// CC0 / royalty-free background music (Mixkit free license)
const MUSIC_TRACKS = [
    { id: 'upbeat1',    label: 'Upbeat Energy',      url: 'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3' },
    { id: 'upbeat2',    label: 'Positive Vibes',      url: 'https://assets.mixkit.co/music/preview/mixkit-happy-vibes-27.mp3' },
    { id: 'upbeat3',    label: 'Inspiring Journey',   url: 'https://assets.mixkit.co/music/preview/mixkit-uplift-me-213.mp3' },
    { id: 'cinematic1', label: 'Cinematic Rise',       url: 'https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3' },
    { id: 'cinematic2', label: 'Epic Strings',         url: 'https://assets.mixkit.co/music/preview/mixkit-dreaming-big-31.mp3' },
];

// CC0 ambient / storytelling sounds (Mixkit free license)
const AMBIENT_SOUNDS = [
    { id: 'rain',      label: 'Soft Rain',       url: 'https://assets.mixkit.co/sfx/preview/mixkit-light-rain-loop-2393.mp3' },
    { id: 'forest',    label: 'Forest Birds',     url: 'https://assets.mixkit.co/sfx/preview/mixkit-forest-birds-ambience-1210.mp3' },
    { id: 'ocean',     label: 'Ocean Waves',      url: 'https://assets.mixkit.co/sfx/preview/mixkit-small-waves-harbor-sounds-820.mp3' },
    { id: 'fire',      label: 'Fireplace',        url: 'https://assets.mixkit.co/sfx/preview/mixkit-campfire-crackles-1330.mp3' },
    { id: 'cafe',      label: 'Café Ambience',    url: 'https://assets.mixkit.co/sfx/preview/mixkit-restaurant-crowd-talking-ambience-439.mp3' },
];

const NOISE_LEVELS = [
    { id: 'off',    label: 'Off',  gain: 0 },
    { id: 'low',    label: 'Low',  gain: 0.03 },
    { id: 'medium', label: 'Med',  gain: 0.07 },
    { id: 'high',   label: 'High', gain: 0.15 },
];

function useWhiteNoise() {
    const ctxRef = useRef(null);
    const nodeRef = useRef(null);
    const gainRef = useRef(null);

    const start = useCallback((gainVal) => {
        if (gainVal <= 0) {
            if (nodeRef.current) { try { nodeRef.current.stop(); } catch {} nodeRef.current = null; }
            return;
        }
        if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = ctxRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        // Stop existing
        if (nodeRef.current) { try { nodeRef.current.stop(); } catch {} nodeRef.current = null; }

        // Build white noise buffer (2-second loop)
        const bufSize = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.loop = true;

        const gain = ctx.createGain();
        gain.gain.value = gainVal;
        gainRef.current = gain;

        source.connect(gain);
        gain.connect(ctx.destination);
        source.start();
        nodeRef.current = source;
    }, []);

    const stop = useCallback(() => {
        if (nodeRef.current) { try { nodeRef.current.stop(); } catch {} nodeRef.current = null; }
        if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
    }, []);

    useEffect(() => () => stop(), [stop]);

    return { start, stop };
}

function TrackSelector({ tracks, selected, onSelect, volume, onVolume, label, icon }) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{icon} {label}</span>
            <div className="flex flex-col gap-1">
                {tracks.map(t => (
                    <button
                        key={t.id}
                        onClick={() => onSelect(selected === t.id ? null : t.id)}
                        className={`text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            selected === t.id
                                ? 'bg-[#d9ff00]/15 border border-[#d9ff00]/40 text-[#d9ff00]'
                                : 'border border-transparent text-white/50 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {selected && (
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/30 w-4">🔊</span>
                    <input
                        type="range" min="0" max="100" value={volume}
                        onChange={e => onVolume(Number(e.target.value))}
                        className="flex-1 accent-[#d9ff00] h-1"
                    />
                    <span className="text-[10px] text-white/40 w-7 text-right">{volume}%</span>
                </div>
            )}
        </div>
    );
}

export default function AudioMixer() {
    const [noiseLevel, setNoiseLevel] = useState('off');
    const [musicTrack, setMusicTrack] = useState(null);
    const [musicVolume, setMusicVolume] = useState(40);
    const [ambientTrack, setAmbientTrack] = useState(null);
    const [ambientVolume, setAmbientVolume] = useState(30);

    const musicAudio = useRef(null);
    const ambientAudio = useRef(null);
    const whiteNoise = useWhiteNoise();

    // White noise
    useEffect(() => {
        const level = NOISE_LEVELS.find(l => l.id === noiseLevel);
        whiteNoise.start(level?.gain || 0);
    }, [noiseLevel, whiteNoise]);

    // Music
    useEffect(() => {
        if (musicAudio.current) { musicAudio.current.pause(); musicAudio.current = null; }
        if (!musicTrack) return;
        const track = MUSIC_TRACKS.find(t => t.id === musicTrack);
        if (!track) return;
        const audio = new Audio(track.url);
        audio.loop = true;
        audio.volume = musicVolume / 100;
        audio.play().catch(() => {});
        musicAudio.current = audio;
        return () => { audio.pause(); };
    }, [musicTrack]);

    useEffect(() => {
        if (musicAudio.current) musicAudio.current.volume = musicVolume / 100;
    }, [musicVolume]);

    // Ambient
    useEffect(() => {
        if (ambientAudio.current) { ambientAudio.current.pause(); ambientAudio.current = null; }
        if (!ambientTrack) return;
        const track = AMBIENT_SOUNDS.find(t => t.id === ambientTrack);
        if (!track) return;
        const audio = new Audio(track.url);
        audio.loop = true;
        audio.volume = ambientVolume / 100;
        audio.play().catch(() => {});
        ambientAudio.current = audio;
        return () => { audio.pause(); };
    }, [ambientTrack]);

    useEffect(() => {
        if (ambientAudio.current) ambientAudio.current.volume = ambientVolume / 100;
    }, [ambientVolume]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (musicAudio.current) musicAudio.current.pause();
            if (ambientAudio.current) ambientAudio.current.pause();
        };
    }, []);

    return (
        <div className="flex flex-col gap-4 p-4 bg-white/[0.02] border border-white/[0.06] rounded-2xl h-full overflow-y-auto custom-scrollbar">
            <span className="text-xs font-bold text-white/60 uppercase tracking-widest">Audio Layers</span>

            {/* White noise */}
            <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">⚡ White Noise</span>
                <div className="flex gap-1.5">
                    {NOISE_LEVELS.map(l => (
                        <button
                            key={l.id}
                            onClick={() => setNoiseLevel(l.id)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                noiseLevel === l.id
                                    ? 'bg-[#d9ff00] text-black'
                                    : 'border border-white/10 text-white/40 hover:text-white hover:border-white/30'
                            }`}
                        >
                            {l.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-px bg-white/[0.06]" />

            <TrackSelector
                tracks={MUSIC_TRACKS}
                selected={musicTrack}
                onSelect={setMusicTrack}
                volume={musicVolume}
                onVolume={setMusicVolume}
                label="Uplifting Music"
                icon="♪"
            />

            <div className="h-px bg-white/[0.06]" />

            <TrackSelector
                tracks={AMBIENT_SOUNDS}
                selected={ambientTrack}
                onSelect={setAmbientTrack}
                volume={ambientVolume}
                onVolume={setAmbientVolume}
                label="Storytelling Sounds"
                icon="🌿"
            />

            <div className="h-px bg-white/[0.06]" />
            <p className="text-[9px] text-white/20 leading-relaxed">
                Audio plays live in your browser. White noise generated via Web Audio API. Music & ambient tracks CC0 via Mixkit.
            </p>
        </div>
    );
}
