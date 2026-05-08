'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { generateSpeech as elGenerateSpeech } from '../providers/elevenlabs.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

const getBackendUrl = () => {
    if (typeof window === 'undefined') return 'http://localhost:8000';
    return (localStorage.getItem('v2v_backend_url') || 'http://localhost:8000').replace(/\/$/, '');
};

const getElKey       = () => (typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_key')   || '' : '');
const getReplicateKey = () => (typeof window !== 'undefined' ? localStorage.getItem('replicate_token') || '' : '');

const v2vFetch = async (path, options = {}) => {
    const elKey  = getElKey();
    const repKey = getReplicateKey();
    const res = await fetch(`/api/v2v${path}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            'x-v2v-backend': getBackendUrl(),
            ...(elKey  ? { 'x-elevenlabs-key': elKey }   : {}),
            ...(repKey ? { 'x-replicate-key':  repKey }  : {}),
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail || err));
    }
    return res.json();
};

// Convert a server-side file path like /path/to/media/job_1/scene_0.png → backend media URL
const toMediaUrl = (filePath) => {
    if (!filePath) return null;
    const norm = filePath.replace(/\\/g, '/');
    const idx = norm.lastIndexOf('/media/');
    if (idx !== -1) return `${getBackendUrl()}${norm.slice(idx)}`;
    const parts = norm.split('/').filter(Boolean);
    return `${getBackendUrl()}/media/${parts.slice(-2).join('/')}`;
};

// Scene statuses in pipeline order
const SCENE_STATUS_ORDER = [
    'raw_extracted', 'raw_text_approved', 'raw_images_approved',
    'rewritten_text_approved', 'generated_images_approved',
    'lipsync_generated', 'lipsync_approved', 'final_approved',
];

const sceneStatusIdx = (s) => SCENE_STATUS_ORDER.indexOf(s);

const STATUS_COLOR = {
    ingested: 'text-blue-400', raw_extracted: 'text-yellow-400',
    raw_text_approved: 'text-orange-400', raw_images_approved: 'text-purple-400',
    rewritten_text_approved: 'text-amber-400', generated_images_approved: 'text-green-400',
    lipsync_generated: 'text-[#d9ff00]', lipsync_approved: 'text-[#d9ff00]',
    subtitles_applied: 'text-emerald-400', final_approved: 'text-emerald-300',
};

const PLATFORM_ICON = { youtube: '▶', instagram: '📷', facebook: '📘', local: '📁' };

const btnPrimary = 'px-3 py-1.5 rounded-lg bg-[#d9ff00] text-black text-xs font-black hover:bg-[#e5ff33] transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const btnGhost   = 'px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-white/60 hover:text-white hover:border-white/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const btnDanger  = 'px-2 py-1 rounded-lg border border-red-500/20 text-[10px] font-bold text-red-400/70 hover:text-red-400 hover:border-red-500/40 transition-all disabled:opacity-40';

const APPROVE_TOOLTIPS = {
    raw_text:        'Approve the raw transcript → AI will rewrite it into a new script',
    raw_images:      'Approve the raw frame → AI will generate a new image from it',
    rewritten_text:  'Approve the rewritten text → unlocks image generation',
    generated_images:'Approve the generated image → triggers lipsync clip generation',
};

// ─── ApproveButton ────────────────────────────────────────────────────────────

function ApproveButton({ jobId, sceneId, stage, label, currentStatus, onRefresh }) {
    const [busy, setBusy] = useState(false);
    const approvedStatus = {
        raw_text: 'raw_text_approved', raw_images: 'raw_images_approved',
        rewritten_text: 'rewritten_text_approved', generated_images: 'generated_images_approved',
    }[stage];
    const targetIdx  = sceneStatusIdx(approvedStatus);
    const currentIdx = sceneStatusIdx(currentStatus);
    const isDone     = currentIdx >= targetIdx && targetIdx >= 0;
    const isNext     = currentIdx === targetIdx - 1;

    const onClick = async () => {
        setBusy(true);
        try {
            await v2vFetch(`/api/jobs/${jobId}/scenes/${sceneId}/approve`, {
                method: 'POST',
                body: JSON.stringify({ stage, decision: 'approved', edited_value: {} }),
            });
            onRefresh();
        } catch (e) { alert(e.message); }
        finally { setBusy(false); }
    };

    if (isDone) return (
        <span title={APPROVE_TOOLTIPS[stage]}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#d9ff00]/10 text-[10px] font-bold text-[#d9ff00]">
            ✓ {label}
        </span>
    );

    return (
        <button onClick={onClick} disabled={!isNext || busy} title={APPROVE_TOOLTIPS[stage]}
            className={`text-[11px] px-2.5 py-1 rounded-lg font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isNext ? 'bg-[#d9ff00] text-black hover:bg-[#e5ff33]' : 'border border-white/10 text-white/30'
            }`}>
            {busy ? '⏳' : label}
        </button>
    );
}

// ─── RetryButton ──────────────────────────────────────────────────────────────

function RetryButton({ jobId, sceneId, stage, label, onRefresh }) {
    const [busy, setBusy] = useState(false);
    const onClick = async () => {
        setBusy(true);
        try {
            await v2vFetch(`/api/jobs/${jobId}/scenes/${sceneId}/retry`, {
                method: 'POST',
                body: JSON.stringify({ stage }),
            });
            onRefresh();
        } catch (e) { alert(e.message); }
        finally { setBusy(false); }
    };
    return (
        <button onClick={onClick} disabled={busy} className={btnDanger}>
            {busy ? '⏳' : `↻ ${label}`}
        </button>
    );
}

// Strip the "no API key" fallback suffix the backend appends when no LLM keys are set
const FALLBACK_SUFFIX_RE = /\s*\(rewritten\s*—[^)]+\)\s*$/i;
const cleanText = (t) => (t || '').replace(FALLBACK_SUFFIX_RE, '').trim();

// ─── SceneCard ────────────────────────────────────────────────────────────────

function SceneCard({ scene, jobId, voices, selectedVoiceId, onRefresh }) {
    const imgInputRef = useRef(null);
    const [uploading,    setUploading]    = useState(false);
    const [editingText,  setEditingText]  = useState(false);
    const [draftText,    setDraftText]    = useState('');
    const [savingText,   setSavingText]   = useState(false);
    const [voiceId,      setVoiceId]      = useState('');
    const [genAudio,     setGenAudio]     = useState(false);
    const [previewing,   setPreviewing]   = useState(false);
    const [genLong,      setGenLong]      = useState(false);
    const [longProgress, setLongProgress] = useState('');
    const [showClone,    setShowClone]    = useState(false);
    const [cloneName,    setCloneName]    = useState('');
    const [cloneFile,    setCloneFile]    = useState(null);
    const [cloning,      setCloning]      = useState(false);
    const [clonedVoice,  setClonedVoice]  = useState(null);
    const [audioCacheKey, setAudioCacheKey] = useState(0);
    const previewAudioRef                 = useRef(null);
    const cloneAudioRef                   = useRef(null);

    // Sync from parent default — but only if no locally cloned voice is saved for this scene
    useEffect(() => {
        const stored = localStorage.getItem(`v2v_clone_${scene.id}`);
        if (!stored) setVoiceId(selectedVoiceId || '');
    }, [selectedVoiceId, scene.id]);

    // Restore cloned voice AND select it — runs after the parent-sync effect, so it wins on mount
    useEffect(() => {
        const stored = localStorage.getItem(`v2v_clone_${scene.id}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setClonedVoice(parsed);
                setVoiceId(parsed.voice_id); // ← use cloned voice, overrides parent default
            } catch {}
        }
    }, [scene.id]);

    const status  = scene.status || '';
    const rawImg  = toMediaUrl(scene.raw_image_path);
    const genImg  = toMediaUrl(scene.generated_image_path);
    const clip    = toMediaUrl(scene.generated_clip_path);

    const saveRewrittenText = async () => {
        setSavingText(true);
        try {
            await v2vFetch(`/api/jobs/${jobId}/scenes/${scene.id}/rewritten-text`, {
                method: 'PUT',
                body: JSON.stringify({ text: draftText }),
            });
            setEditingText(false);
            onRefresh();
        } catch (e) { alert(e.message); }
        finally { setSavingText(false); }
    };

    const generateAudio = async () => {
        setGenAudio(true);
        try {
            await v2vFetch(`/api/jobs/${jobId}/scenes/${scene.id}/generate-voice`, {
                method: 'POST',
                body: JSON.stringify({ voice_id: voiceId || undefined }),
            });
            setAudioCacheKey(k => k + 1); // force audio player to re-fetch the new file
            onRefresh();
        } catch (e) { alert(`Audio generation failed: ${e.message}`); }
        finally { setGenAudio(false); }
    };

    const cloneVoice = async () => {
        if (!cloneFile || !cloneName.trim()) return;
        const elKey = getElKey();
        if (!elKey) { alert('ElevenLabs API key not found — go to ⚙ Settings.'); return; }
        setCloning(true);
        try {
            const fd = new FormData();
            fd.append('name', cloneName.trim());
            fd.append('files', cloneFile);
            const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
                method: 'POST',
                headers: { 'xi-api-key': elKey },
                body: fd,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail?.message || err.detail || `HTTP ${res.status}`);
            }
            const { voice_id } = await res.json();
            const newVoice = { voice_id, name: cloneName.trim() };
            setClonedVoice(newVoice);
            setVoiceId(voice_id);
            localStorage.setItem(`v2v_clone_${scene.id}`, JSON.stringify(newVoice));
            setShowClone(false);
            setCloneFile(null);
            setCloneName('');
        } catch (e) { alert(`Clone failed: ${e.message}`); }
        finally { setCloning(false); }
    };

    const useVideoAudio = async () => {
        try {
            const res = await fetch(`/api/v2v/api/jobs/${jobId}/source-audio`, {
                headers: { 'x-v2v-backend': getBackendUrl() },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const contentDisp = res.headers.get('content-disposition') || '';
            const nameMatch = contentDisp.match(/filename="([^"]+)"/);
            const fileName = nameMatch ? nameMatch[1] : 'source_audio.wav';
            setCloneFile(new File([blob], fileName, { type: blob.type || 'audio/wav' }));
        } catch (e) { alert(`Could not load video audio: ${e.message}`); }
    };

    const cloneFromVideo = async () => {
        const nameToUse = cloneName.trim();
        if (!nameToUse) { alert('Enter a voice name first.'); return; }
        const elKey = getElKey();
        if (!elKey) { alert('ElevenLabs API key not found — go to ⚙ Settings.'); return; }
        setCloning(true);
        try {
            // Step 1: pull source audio from backend through the proxy
            const audioRes = await fetch(`/api/v2v/api/jobs/${jobId}/source-audio`, {
                headers: { 'x-v2v-backend': getBackendUrl() },
            });
            if (!audioRes.ok) {
                const err = await audioRes.json().catch(() => ({}));
                throw new Error(err.detail || `Could not load video audio (HTTP ${audioRes.status})`);
            }
            const audioBlob = await audioRes.blob();
            const contentDisp = audioRes.headers.get('content-disposition') || '';
            const nameMatch = contentDisp.match(/filename="([^"]+)"/);
            const fileName = nameMatch ? nameMatch[1] : 'source_audio.wav';
            const audioFile = new File([audioBlob], fileName, { type: audioBlob.type || 'audio/wav' });

            // Step 2: clone directly to ElevenLabs
            const fd = new FormData();
            fd.append('name', nameToUse);
            fd.append('files', audioFile);
            const cloneRes = await fetch('https://api.elevenlabs.io/v1/voices/add', {
                method: 'POST',
                headers: { 'xi-api-key': elKey },
                body: fd,
            });
            if (!cloneRes.ok) {
                const err = await cloneRes.json().catch(() => ({}));
                throw new Error(err.detail?.message || err.detail || `ElevenLabs error HTTP ${cloneRes.status}`);
            }
            const { voice_id } = await cloneRes.json();
            const newVoice = { voice_id, name: nameToUse };
            setClonedVoice(newVoice);
            setVoiceId(voice_id);
            localStorage.setItem(`v2v_clone_${scene.id}`, JSON.stringify(newVoice));
            setShowClone(false);
            setCloneName('');
        } catch (e) { alert(`Clone from video failed: ${e.message}`); }
        finally { setCloning(false); }
    };

    const previewVoice = async () => {
        const vid = voiceId || voices[0]?.voice_id;
        if (!vid) return;
        const elKey = getElKey();
        if (!elKey) { alert('ElevenLabs API key not found. Go to ⚙ Settings and add your ElevenLabs key.'); return; }
        setPreviewing(true);
        try {
            const blob = await elGenerateSpeech(elKey, {
                voiceId: vid,
                text: "Hello, this is a quick preview of how I'll sound in your clip.",
            });
            const url = URL.createObjectURL(blob);
            if (previewAudioRef.current) {
                previewAudioRef.current.src = url;
                previewAudioRef.current.play();
            }
        } catch (e) { alert(`Preview failed: ${e.message}`); }
        finally { setPreviewing(false); }
    };

    const generateLongLipsync = async () => {
        setGenLong(true);
        setLongProgress('Splitting audio…');
        try {
            const d = await v2vFetch(`/api/jobs/${jobId}/scenes/${scene.id}/generate-long-lipsync`, {
                method: 'POST',
                body: JSON.stringify({ segment_duration: 15 }),
            });
            setLongProgress(`Done — ${d.segments} clips merged (${d.total_seconds}s)`);
            onRefresh();
        } catch (e) { alert(`Long lipsync failed: ${e.message}`); setLongProgress(''); }
        finally { setGenLong(false); }
    };

    const uploadImage = async (file) => {
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch(`/api/v2v/api/jobs/${jobId}/scenes/${scene.id}/upload-generated-image`, {
                method: 'POST',
                headers: { 'x-v2v-backend': getBackendUrl() },
                body: fd,
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.detail || `HTTP ${res.status}`);
            }
            onRefresh();
        } catch (e) { alert(e.message); }
        finally { setUploading(false); }
    };

    return (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            {/* Header */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-black text-white">Scene {scene.scene_index + 1}</span>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white/20">
                        {scene.start_second?.toFixed(1)}s–{scene.end_second?.toFixed(1)}s
                    </span>
                    <span className={`text-[10px] font-bold ${STATUS_COLOR[status] || 'text-white/30'}`}>{status || 'pending'}</span>
                </div>
            </div>

            {/* Images row */}
            <div className="flex gap-2">
                {rawImg && (
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                            <p className="text-[9px] text-white/30">Raw Frame</p>
                            <RetryButton jobId={jobId} sceneId={scene.id} stage="raw_frame" label="Re-frame" onRefresh={onRefresh} />
                        </div>
                        <img src={rawImg} alt="raw" className="w-full rounded-lg object-cover aspect-video bg-black/40" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] text-white/30">Generated</p>
                        <div className="flex items-center gap-1">
                            {genImg && <RetryButton jobId={jobId} sceneId={scene.id} stage="generated_image" label="Retry" onRefresh={onRefresh} />}
                        </div>
                    </div>
                    {genImg
                        ? <img src={genImg} alt="generated" className="w-full rounded-lg object-cover aspect-video bg-black/40" />
                        : <div className="w-full aspect-video rounded-lg bg-black/30 border border-dashed border-white/10 flex flex-col items-center justify-center gap-1">
                            <span className="text-[10px] text-white/20">No image yet</span>
                          </div>
                    }
                    {/* Upload own image */}
                    <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                    <button onClick={() => imgInputRef.current?.click()} disabled={uploading}
                        className="mt-1 w-full text-[10px] py-1 rounded-lg border border-dashed border-white/10 text-white/30 hover:border-[#d9ff00]/30 hover:text-[#d9ff00]/60 transition-all">
                        {uploading ? '⏳ Uploading…' : '⬆ Use your own image'}
                    </button>
                </div>
            </div>

            {/* Clip */}
            {clip && (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] text-[#d9ff00]/50">LipSync Clip</p>
                        <RetryButton jobId={jobId} sceneId={scene.id} stage="talking_clip" label="Re-render" onRefresh={onRefresh} />
                    </div>
                    <video src={clip} controls className="w-full rounded-lg" />
                </div>
            )}

            {/* Texts */}
            {scene.raw_text && (
                <div>
                    <p className="text-[9px] text-white/30 mb-0.5">Original Text</p>
                    <p className="text-xs text-white/50 leading-relaxed">{scene.raw_text}</p>
                </div>
            )}
            {scene.rewritten_text && (
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] text-[#d9ff00]/60">Rewritten</p>
                        <div className="flex items-center gap-1">
                            <RetryButton jobId={jobId} sceneId={scene.id} stage="rewritten_text" label="Rewrite" onRefresh={onRefresh} />
                            {!editingText && (
                                <button
                                    onClick={() => { setDraftText(cleanText(scene.rewritten_text)); setEditingText(true); }}
                                    className="px-2 py-0.5 rounded text-[10px] font-bold border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-all">
                                    ✏ Edit
                                </button>
                            )}
                        </div>
                    </div>
                    {editingText ? (
                        <div className="flex flex-col gap-1.5">
                            <textarea
                                value={draftText}
                                onChange={e => setDraftText(e.target.value)}
                                rows={4}
                                className="w-full bg-black/40 border border-[#d9ff00]/30 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-[#d9ff00]/60 resize-y leading-relaxed custom-scrollbar"
                            />
                            <div className="flex gap-1.5">
                                <button onClick={saveRewrittenText} disabled={savingText} className={`${btnPrimary} flex-1`}>
                                    {savingText ? 'Saving…' : '✓ Save Text'}
                                </button>
                                <button onClick={() => setEditingText(false)} className={`${btnGhost}`}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-xs text-white/80 leading-relaxed">{cleanText(scene.rewritten_text)}</p>
                    )}
                </div>
            )}

            {/* ── Voice & Audio ── */}
            {(scene.raw_text || scene.rewritten_text) && (
                <div className="flex flex-col gap-2.5 pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">🎙 Voice & Audio</span>
                        <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-[#d9ff00]/40 hover:text-[#d9ff00] transition-colors">
                            Browse voices ↗
                        </a>
                    </div>

                    {/* ── 1. Generate Voice (clone) ── */}
                    <div className="flex flex-col gap-1.5">
                        <button onClick={() => setShowClone(v => !v)}
                            className="flex items-center gap-1.5 text-[11px] font-bold text-white/50 hover:text-white transition-colors">
                            <span className="text-[9px]">{showClone ? '▾' : '▸'}</span>
                            🎤 Generate Voice
                            <span className="text-[9px] text-white/20 font-normal">— clone from audio</span>
                        </button>

                        {showClone && (
                            <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                                <input value={cloneName} onChange={e => setCloneName(e.target.value)}
                                    placeholder="Voice name (e.g. My Speaker)"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-[#d9ff00]/40" />

                                {/* Quick one-click: extract from uploaded video → clone */}
                                <button onClick={cloneFromVideo} disabled={cloning || !cloneName.trim()}
                                    title="Extracts audio from your uploaded video and clones the voice in ElevenLabs in one step"
                                    className={`${btnPrimary} w-full`}>
                                    {cloning ? '⏳ Cloning from video…' : '⚡ Clone voice from uploaded video'}
                                </button>

                                {/* Divider */}
                                <div className="flex items-center gap-2 my-0.5">
                                    <div className="flex-1 h-px bg-white/[0.06]" />
                                    <span className="text-[9px] text-white/20">or upload your own audio</span>
                                    <div className="flex-1 h-px bg-white/[0.06]" />
                                </div>

                                <input ref={cloneAudioRef} type="file" accept="audio/*,video/mp4,.mp4,.mp3,.wav,.m4a"
                                    className="hidden"
                                    onChange={e => setCloneFile(e.target.files?.[0] || null)} />
                                <div className="flex gap-1.5">
                                    <button onClick={() => cloneAudioRef.current?.click()}
                                        className={`${btnGhost} flex-1 truncate`}>
                                        {cloneFile ? `📎 ${cloneFile.name.slice(0, 22)}` : '⬆ Upload audio / video file'}
                                    </button>
                                    {cloneFile && (
                                        <button onClick={() => setCloneFile(null)}
                                            className="text-white/20 hover:text-red-400 text-xs transition-colors flex-shrink-0 px-1">✕</button>
                                    )}
                                </div>
                                {cloneFile && (
                                    <button onClick={cloneVoice} disabled={cloning || !cloneName.trim()}
                                        className={`${btnGhost} w-full`}>
                                        {cloning ? '⏳ Cloning…' : '🎤 Clone from this file'}
                                    </button>
                                )}
                            </div>
                        )}

                        {clonedVoice && (
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#d9ff00]/5 border border-[#d9ff00]/20">
                                <span className="text-[10px] text-[#d9ff00] flex-1 truncate">✓ Cloned: {clonedVoice.name}</span>
                                <button onClick={() => setVoiceId(clonedVoice.voice_id)}
                                    className="text-[9px] text-white/40 hover:text-white transition-colors flex-shrink-0">
                                    {voiceId === clonedVoice.voice_id ? '● Selected' : 'Select'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── 2. Select voice + preview ── */}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] text-white/30">Select voice for audio generation</span>
                        <div className="flex gap-1.5">
                            <select value={voiceId} onChange={e => setVoiceId(e.target.value)}
                                className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-[#d9ff00]/40">
                                <option value="">Use default voice</option>
                                {clonedVoice && (
                                    <option value={clonedVoice.voice_id}>🎤 {clonedVoice.name} (cloned)</option>
                                )}
                                {voices.map(v => (
                                    <option key={v.voice_id} value={v.voice_id}>{v.name} — {v.short_description || ''}</option>
                                ))}
                            </select>
                            <button onClick={previewVoice} disabled={previewing || genAudio || genLong}
                                title="Preview selected voice"
                                className={`${btnGhost} px-3 flex-shrink-0`}>
                                {previewing ? '⏳' : '▶'}
                            </button>
                        </div>
                        <audio ref={previewAudioRef} className="hidden" />
                    </div>

                    {/* ── 3. Generate Audio ── */}
                    <div className="flex flex-col gap-1">
                        {/* Active voice indicator */}
                        <div className="flex items-center gap-1.5 px-1">
                            <span className="text-[9px] text-white/25">Using voice:</span>
                            <span className="text-[9px] font-bold text-[#d9ff00]/60 truncate">
                                {voiceId
                                    ? (clonedVoice?.voice_id === voiceId
                                        ? `🎤 ${clonedVoice.name} (cloned)`
                                        : (voices.find(v => v.voice_id === voiceId)?.name || voiceId.slice(0, 16) + '…'))
                                    : 'default (George)'}
                            </span>
                        </div>
                        <div className="flex gap-1.5 items-center">
                            <button onClick={generateAudio} disabled={genAudio || genLong}
                                className={`${btnPrimary} flex-1`}>
                                {genAudio ? '⏳ Generating…' : '🎵 Generate Audio'}
                            </button>
                            {scene.generated_audio_path && (
                                <audio controls
                                    key={audioCacheKey}
                                    src={`${toMediaUrl(scene.generated_audio_path)}?v=${audioCacheKey}`}
                                    className="flex-1 h-8 min-w-0"
                                    style={{ height: '30px', filter: 'invert(1) hue-rotate(60deg) brightness(0.7)' }} />
                            )}
                        </div>
                    </div>

                    {/* ── 4. Long LipSync ── */}
                    {scene.generated_audio_path && (
                        <div className="flex flex-col gap-1">
                            <button onClick={generateLongLipsync} disabled={genLong || genAudio}
                                title="Splits audio into 15s chunks → Higgsfield per chunk → merges into one clip"
                                className={`${btnPrimary} w-full`}>
                                {genLong ? `⏳ ${longProgress || 'Processing…'}` : '🎬 Generate Long LipSync'}
                            </button>
                            {longProgress && !genLong && (
                                <p className="text-[10px] text-[#d9ff00] text-center">{longProgress}</p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Approval buttons row — all 4 stages always visible */}
            <div className="pt-2 border-t border-white/[0.06] flex flex-wrap gap-1.5">
                <ApproveButton jobId={jobId} sceneId={scene.id} stage="raw_text"        label="1. Text"          currentStatus={status} onRefresh={onRefresh} />
                <ApproveButton jobId={jobId} sceneId={scene.id} stage="raw_images"      label="2. Gen Image"    currentStatus={status} onRefresh={onRefresh} />
                <ApproveButton jobId={jobId} sceneId={scene.id} stage="rewritten_text"  label="3. Rewrite"      currentStatus={status} onRefresh={onRefresh} />
                <ApproveButton jobId={jobId} sceneId={scene.id} stage="generated_images" label="4. → LipSync"   currentStatus={status} onRefresh={onRefresh} />
            </div>
        </div>
    );
}

// ─── LipsyncSettings ──────────────────────────────────────────────────────────

const PROVIDER_LABELS = { higgsfield: 'Higgsfield', veo3: 'Veo 3', replicate: 'Replicate' };
const PROVIDER_DESC   = {
    higgsfield: 'ElevenLabs voice · strong identity · 5/10/15s clips',
    veo3:       'Google Veo 3 · cinematic · own voice · 4/6/8s clips',
    replicate:  'Any Replicate model · full audio length · pay-as-you-go',
};

function LipsyncSettings({ jobId }) {
    const [collapsed,     setCollapsed]     = useState(false);
    const [provider,      setProvider]      = useState('higgsfield');
    const [duration,      setDuration]      = useState(5);
    const [durationOpts,  setDurationOpts]  = useState({ higgsfield: [5, 10, 15], veo3: [4, 6, 8], replicate: [] });
    const [saving,        setSaving]        = useState(false);
    const [msg,           setMsg]           = useState('');
    // Replicate-specific — "saved" tracks what's persisted; "rep*" is what's in the inputs
    const [repModel,      setRepModel]      = useState('prunaai/p-video-avatar');
    const [repResolution, setRepResolution] = useState('720p');
    const [savedModel,    setSavedModel]    = useState('prunaai/p-video-avatar');
    const [savedRes,      setSavedRes]      = useState('720p');
    const [repSaving,     setRepSaving]     = useState(false);

    useEffect(() => {
        v2vFetch(`/api/jobs/${jobId}/lipsync-provider`).then(d => {
            setProvider(d.provider || 'higgsfield');
            setDuration(d.duration || 5);
            if (d.duration_options_by_provider) setDurationOpts(d.duration_options_by_provider);
        }).catch(() => {});
        v2vFetch(`/api/jobs/${jobId}/replicate-config`).then(d => {
            const m = d.model      || 'prunaai/p-video-avatar';
            const r = d.resolution || '720p';
            setRepModel(m);    setSavedModel(m);
            setRepResolution(r); setSavedRes(r);
        }).catch(() => {});
    }, [jobId]);

    const isDirty = repModel.trim() !== savedModel || repResolution !== savedRes;

    const saveProvider = async (newProvider, newDuration) => {
        setSaving(true);
        try {
            if (newProvider !== provider) {
                const d = await v2vFetch(`/api/jobs/${jobId}/lipsync-provider`, {
                    method: 'PUT', body: JSON.stringify({ provider: newProvider }),
                });
                setProvider(newProvider);
                setDuration(d.duration || newDuration);
            } else if (newDuration !== duration) {
                await v2vFetch(`/api/jobs/${jobId}/lipsync-duration`, {
                    method: 'PUT', body: JSON.stringify({ duration: newDuration, provider: newProvider }),
                });
                setDuration(newDuration);
            }
            setMsg('Saved');
            setTimeout(() => setMsg(''), 2000);
        } catch (e) { setMsg(e.message); }
        finally { setSaving(false); }
    };

    const saveReplicateConfig = async () => {
        const repKey = getReplicateKey();
        if (!repKey) { setMsg('Add Replicate token in ⚙ Settings first'); return; }
        const modelTrimmed = repModel.trim();
        if (!modelTrimmed.includes('/')) { setMsg('Model must be owner/name'); return; }
        setRepSaving(true);
        try {
            await v2vFetch(`/api/jobs/${jobId}/replicate-config`, {
                method: 'PUT',
                body: JSON.stringify({ model: modelTrimmed, resolution: repResolution }),
            });
            setSavedModel(modelTrimmed);
            setSavedRes(repResolution);
            setRepModel(modelTrimmed);
            setMsg('Model saved');
            setTimeout(() => setMsg(''), 2500);
        } catch (e) { setMsg(e.message); }
        finally { setRepSaving(false); }
    };

    const opts = durationOpts[provider] || [];

    return (
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
            {/* Header — always visible, click to collapse/expand */}
            <button
                onClick={() => setCollapsed(c => !c)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.03] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">LipSync Settings</span>
                    {!collapsed && provider && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40 font-bold">
                            {PROVIDER_LABELS[provider]}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {(saving || repSaving) && <span className="text-[10px] text-white/30 animate-pulse">Saving…</span>}
                    {!(saving || repSaving) && msg && <span className="text-[10px] text-[#d9ff00]">{msg}</span>}
                    <span className="text-white/30 text-[10px]">{collapsed ? '▶' : '▼'}</span>
                </div>
            </button>

            {!collapsed && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                    {/* Provider selector */}
                    <div className="flex gap-1">
                        {['higgsfield', 'veo3', 'replicate'].map(p => (
                            <button key={p} onClick={() => saveProvider(p, durationOpts[p]?.[0] ?? duration)}
                                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                    provider === p ? 'bg-[#d9ff00] text-black' : 'border border-white/10 text-white/40 hover:text-white'
                                }`}>
                                {PROVIDER_LABELS[p]}
                            </button>
                        ))}
                    </div>
                    <p className="text-[9px] text-white/25 -mt-1">{PROVIDER_DESC[provider]}</p>

                    {/* Duration — hidden for Replicate */}
                    {provider !== 'replicate' && opts.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-white/40 flex-shrink-0">Clip length</span>
                            <div className="flex gap-1">
                                {opts.map(s => (
                                    <button key={s} onClick={() => saveProvider(provider, s)}
                                        className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                                            duration === s ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30'
                                                          : 'border border-white/10 text-white/30 hover:text-white'
                                        }`}>
                                        {s}s
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Replicate model config */}
                    {provider === 'replicate' && (
                        <div className="flex flex-col gap-2 pt-1 border-t border-white/[0.06]">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-white/40">Model</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#d9ff00]/10 text-[#d9ff00] font-bold">
                                        ⭐ recommended
                                    </span>
                                </div>
                                <input
                                    value={repModel}
                                    onChange={e => setRepModel(e.target.value)}
                                    placeholder="owner/model-name"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono outline-none focus:border-[#d9ff00]/40"
                                />
                                <p className="text-[9px] text-white/20">
                                    e.g. <span className="text-white/40 font-mono">prunaai/p-video-avatar</span>
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-white/40 flex-shrink-0">Resolution</span>
                                <div className="flex gap-1">
                                    {['720p', '1080p'].map(r => (
                                        <button key={r} onClick={() => setRepResolution(r)}
                                            className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-all ${
                                                repResolution === r
                                                    ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30'
                                                    : 'border border-white/10 text-white/30 hover:text-white'
                                            }`}>
                                            {r}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={saveReplicateConfig} disabled={repSaving}
                                    className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap border ${
                                        isDirty
                                            ? 'bg-[#d9ff00] text-black border-[#d9ff00] hover:bg-[#e5ff33]'
                                            : 'border-white/10 text-white/50 hover:text-white hover:border-white/30'
                                    }`}>
                                    {repSaving ? '⏳' : isDirty ? '● Save' : '✓ Saved'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── JobDetail ────────────────────────────────────────────────────────────────

function JobDetail({ job, onRefresh }) {
    const [scenes,        setScenes]        = useState([]);
    const [loading,       setLoading]       = useState(true);
    const [busy,          setBusy]          = useState(false);
    const [voices,        setVoices]        = useState([]);
    const [selectedVoice, setSelectedVoice] = useState('');
    const pollRef                           = useRef(null);

    useEffect(() => {
        v2vFetch('/api/jobs/voices').then(d => setVoices(d.voices || [])).catch(() => {});
        v2vFetch('/api/jobs/voice').then(d => setSelectedVoice(d.voice_id || '')).catch(() => {});
    }, []);

    const loadScenes = useCallback(async () => {
        try {
            const data = await v2vFetch(`/api/jobs/${job.id}/scenes`);
            setScenes(data);
        } catch { /* ignore */ }
        setLoading(false);
    }, [job.id]);

    useEffect(() => {
        loadScenes();
        const shouldPoll = ['ingested', 'raw_extracted', 'generated_images_approved'].includes(job.status);
        if (shouldPoll) pollRef.current = setInterval(loadScenes, 5000);
        return () => clearInterval(pollRef.current);
    }, [job.id, job.status, loadScenes]);

    const action = async (path, label) => {
        setBusy(true);
        try {
            await v2vFetch(path, { method: 'POST' });
            await loadScenes();
            onRefresh();
        } catch (e) { alert(`${label} failed: ${e.message}`); }
        finally { setBusy(false); }
    };

    const statusColor = STATUS_COLOR[job.status] || 'text-white/40';
    const platform = job.platform || '';

    // Determine final video URL from job output_video_path (may not be in the schema we get from /admin/dashboard)
    const finalVideo = job.output_video_path ? toMediaUrl(job.output_video_path) : null;

    // Job-level action buttons based on status
    const jobActions = () => {
        if (job.status === 'ingested')
            return <button onClick={() => action(`/api/jobs/${job.id}/process`, 'Extract')} disabled={busy} className={btnPrimary}>▶ Extract Scenes</button>;
        if (job.status === 'generated_images_approved')
            return <button onClick={() => action(`/api/jobs/${job.id}/generate-lipsync`, 'Generate')} disabled={busy} className={btnPrimary}>{busy ? '⏳ Generating…' : '🎬 Generate LipSync Video'}</button>;
        if (job.status === 'lipsync_generated')
            return <button onClick={() => action(`/api/jobs/${job.id}/approve-lipsync`, 'Approve')} disabled={busy} className={btnPrimary}>✓ Approve LipSync</button>;
        if (job.status === 'lipsync_approved')
            return <button onClick={() => action(`/api/finalize/${job.id}`, 'Compose')} disabled={busy} className={btnPrimary}>{busy ? '⏳ Composing…' : '🎞 Compose Final Video'}</button>;
        if (job.status === 'subtitles_applied')
            return (
                <div className="flex flex-col gap-2">
                    {finalVideo && <video src={finalVideo} controls className="rounded-xl max-h-48 w-full" />}
                    <button onClick={() => action(`/api/jobs/${job.id}/approve-final`, 'Approve Final')} disabled={busy} className={btnPrimary}>✓ Approve Final</button>
                </div>
            );
        return null;
    };

    return (
        <div className="flex flex-col gap-4 h-full overflow-hidden">
            {/* Job header */}
            <div className="flex items-start justify-between gap-3 flex-shrink-0">
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base">{PLATFORM_ICON[platform] || '🎬'}</span>
                        <span className="text-sm font-black text-white">Job #{job.id}</span>
                        <span className={`text-xs font-bold ${statusColor}`}>{job.status}</span>
                    </div>
                    <span className="text-[11px] text-white/25 truncate max-w-xs">{job.input_url}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {jobActions()}
                    <button onClick={() => { onRefresh(); loadScenes(); }} className={btnGhost} disabled={busy}>↺</button>
                </div>
            </div>

            {/* LipSync settings — always visible when job has scenes */}
            {scenes.length > 0 && (
                <div className="flex-shrink-0">
                    <LipsyncSettings jobId={job.id} />
                </div>
            )}

            {/* Scenes */}
            {loading ? (
                <div className="flex-1 flex items-center justify-center text-white/30 text-sm">Loading scenes…</div>
            ) : scenes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/20">
                    {job.status === 'ingested' ? (
                        <>
                            <p className="text-sm">Job ready — click "Extract Scenes" to begin.</p>
                            <button onClick={() => action(`/api/jobs/${job.id}/process`, 'Extract')} disabled={busy} className={btnPrimary}>▶ Extract Scenes</button>
                        </>
                    ) : <p className="text-sm">No scenes found.</p>}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-4">
                        {scenes.map(s => (
                            <SceneCard key={s.id} scene={s} jobId={job.id}
                                voices={voices} selectedVoiceId={selectedVoice}
                                onRefresh={loadScenes} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── V2VMain ──────────────────────────────────────────────────────────────────

function V2VMain() {
    const [url, setUrl]               = useState('');
    const [jobs, setJobs]             = useState([]);
    const [selectedJob, setSelected]  = useState(null);
    const [creating, setCreating]     = useState(false);
    const [uploading, setUploading]   = useState(false);
    const [uploadFile, setUploadFile] = useState(null);
    const [error, setError]           = useState('');
    const fileInputRef                = useRef(null);

    const loadJobs = useCallback(async () => {
        try {
            const data = await v2vFetch('/api/admin/dashboard');
            setJobs(data.jobs || []);
        } catch { /* backend may not be running yet */ }
    }, []);

    useEffect(() => { loadJobs(); }, [loadJobs]);

    const createJob = async (e) => {
        e.preventDefault();
        if (!url.trim()) return;
        setCreating(true); setError('');
        try {
            const job = await v2vFetch('/api/jobs', { method: 'POST', body: JSON.stringify({ input_url: url.trim() }) });
            setUrl('');
            await loadJobs();
            setSelected(job);
        } catch (e) { setError(e.message); }
        finally { setCreating(false); }
    };

    const uploadVideo = async () => {
        if (!uploadFile) return;
        setUploading(true); setError('');
        try {
            const form = new FormData();
            form.append('file', uploadFile);
            const res = await fetch('/api/v2v/api/jobs/upload-video', {
                method: 'POST',
                headers: { 'x-v2v-backend': getBackendUrl() },
                body: form,
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.detail || `HTTP ${res.status}`);
            }
            const job = await res.json();
            setUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            await loadJobs();
            setSelected(job);
        } catch (e) { setError(e.message); }
        finally { setUploading(false); }
    };

    const busy = creating || uploading;

    return (
        <div className="flex flex-1 overflow-hidden gap-0">
            {/* Sidebar */}
            <div className="w-64 flex-shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
                <form onSubmit={createJob} className="p-3 border-b border-white/[0.06] flex flex-col gap-2">
                    <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                        placeholder="YouTube / Instagram / Facebook URL"
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 outline-none focus:border-[#d9ff00]/40" />
                    <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
                        {creating ? 'Creating…' : '+ From URL'}
                    </button>

                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-px bg-white/[0.06]" />
                        <span className="text-[10px] text-white/20">or</span>
                        <div className="flex-1 h-px bg-white/[0.06]" />
                    </div>

                    <input ref={fileInputRef} type="file"
                        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.avi,.mkv"
                        className="hidden"
                        onChange={e => setUploadFile(e.target.files?.[0] || null)} />

                    {uploadFile ? (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2 bg-[#d9ff00]/5 border border-[#d9ff00]/20 rounded-lg px-2 py-1.5">
                                <span className="text-[10px] text-[#d9ff00] flex-1 truncate">{uploadFile.name}</span>
                                <button type="button" onClick={() => { setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                    className="text-white/30 hover:text-white text-xs flex-shrink-0">✕</button>
                            </div>
                            <button type="button" onClick={uploadVideo} disabled={busy} className={`${btnPrimary} w-full`}>
                                {uploading ? '⏳ Uploading…' : '▶ Upload & Process'}
                            </button>
                            {uploading && <p className="text-[10px] text-white/25 text-center">Whisper transcribing — ~30s</p>}
                        </div>
                    ) : (
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className={`${btnGhost} w-full`}>
                            📁 Upload Local Video
                        </button>
                    )}

                    {error && <p className="text-[10px] text-red-400">{error}</p>}
                </form>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {jobs.length === 0
                        ? <p className="text-[11px] text-white/20 text-center py-8 px-3">No jobs yet.</p>
                        : jobs.map(j => (
                            <button key={j.id} onClick={() => setSelected(j)}
                                className={`w-full text-left px-3 py-3 border-b border-white/[0.04] flex flex-col gap-0.5 transition-colors ${
                                    selectedJob?.id === j.id ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                                }`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white">
                                        {PLATFORM_ICON[j.platform] || '🎬'} #{j.id}
                                    </span>
                                    <span className={`text-[9px] font-bold ${STATUS_COLOR[j.status] || 'text-white/30'}`}>{j.status}</span>
                                </div>
                                <span className="text-[10px] text-white/25 truncate">{j.url || j.input_url}</span>
                            </button>
                        ))
                    }
                </div>
            </div>

            {/* Main area */}
            <div className="flex-1 overflow-hidden p-4">
                {selectedJob
                    ? <JobDetail key={selectedJob.id} job={selectedJob}
                        onRefresh={async () => {
                            await loadJobs();
                            // Re-fetch full job details to get output_video_path
                            try {
                                const d = await v2vFetch(`/api/admin/jobs/${selectedJob.id}`);
                                if (d.job) setSelected(prev => ({ ...prev, ...d.job }));
                            } catch { /* ignore */ }
                        }} />
                    : <div className="h-full flex flex-col items-center justify-center gap-3 text-white/20">
                        <span className="text-4xl">🎬</span>
                        <p className="text-sm">Select a job or create one</p>
                      </div>
                }
            </div>
        </div>
    );
}

// ─── PromptEditor ─────────────────────────────────────────────────────────────

function PromptEditor({ title, value, defaultValue, onChange, onSave, onReset, saving }) {
    return (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{title}</h3>
                <div className="flex gap-2">
                    {defaultValue && <button onClick={onReset} className={btnGhost}>Reset</button>}
                    <button onClick={onSave} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </div>
            <textarea value={value} onChange={e => onChange(e.target.value)} rows={6}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus:border-[#d9ff00]/40 resize-y font-mono leading-relaxed custom-scrollbar" />
        </div>
    );
}

// ─── VoiceCard ────────────────────────────────────────────────────────────────

function VoiceCard({ voice, selected, onSelect, sampleText }) {
    const [previewing, setPreviewing] = useState(false);
    const audioRef = useRef(null);

    const preview = async () => {
        const elKey = getElKey();
        if (!elKey) { alert('ElevenLabs API key not found. Go to ⚙ Settings and add your ElevenLabs key.'); return; }
        setPreviewing(true);
        try {
            const blob = await elGenerateSpeech(elKey, {
                voiceId: voice.voice_id,
                text: sampleText || 'Hello, this is a quick preview of how I\'ll sound.',
            });
            const url = URL.createObjectURL(blob);
            if (audioRef.current) {
                audioRef.current.src = url;
                audioRef.current.play();
            }
        } catch (e) { alert(e.message); }
        finally { setPreviewing(false); }
    };

    return (
        <div className={`flex flex-col gap-2 p-3 rounded-xl border transition-all ${
            selected ? 'border-[#d9ff00]/40 bg-[#d9ff00]/5' : 'border-white/[0.06] bg-white/[0.02]'
        }`}>
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-bold text-white">{voice.name || voice.voice_id}</p>
                    <p className="text-[10px] text-white/30">
                        {[voice.gender, voice.age, voice.accent, voice.use_case].filter(Boolean).join(' · ')}
                    </p>
                </div>
                {selected && <span className="text-[10px] text-[#d9ff00] font-bold flex-shrink-0">✓ Active</span>}
            </div>
            {voice.short_description && <p className="text-[10px] text-white/50">{voice.short_description}</p>}
            <div className="flex gap-1.5">
                <button onClick={preview} disabled={previewing} className={`${btnGhost} flex-1`}>
                    {previewing ? '⏳' : '▶ Preview'}
                </button>
                {!selected && (
                    <button onClick={() => onSelect(voice.voice_id)} className={`${btnPrimary} flex-1`}>Use</button>
                )}
            </div>
            <audio ref={audioRef} className="hidden" />
        </div>
    );
}

// ─── VoiceCloner ──────────────────────────────────────────────────────────────

function VoiceCloner({ onVoiceCreated }) {
    const [name,         setName]         = useState('');
    const [file,         setFile]         = useState(null);
    const [cloning,      setCloning]      = useState(false);
    const [myVoices,     setMyVoices]     = useState([]);
    const [loadingList,  setLoadingList]  = useState(false);
    const [previewing,   setPreviewing]   = useState(null); // voice_id being previewed
    const [sampleText,   setSampleText]   = useState('Hello, this is a test of my cloned voice.');
    const fileRef  = useRef(null);
    const audioRef = useRef(null);

    const elBase = 'https://api.elevenlabs.io';

    const loadMyVoices = async () => {
        const elKey = getElKey();
        if (!elKey) return;
        setLoadingList(true);
        try {
            const res = await fetch(`${elBase}/v1/voices`, { headers: { 'xi-api-key': elKey } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            // Only show voices the user created (not built-in premade ones)
            setMyVoices((data.voices || []).filter(v => v.category !== 'premade'));
        } catch { /* silently ignore */ }
        finally { setLoadingList(false); }
    };

    useEffect(() => { loadMyVoices(); }, []);

    const cloneVoice = async () => {
        if (!file || !name.trim()) return;
        const elKey = getElKey();
        if (!elKey) { alert('ElevenLabs API key not found — go to ⚙ Settings.'); return; }
        setCloning(true);
        try {
            const fd = new FormData();
            fd.append('name', name.trim());
            fd.append('files', file);
            const res = await fetch(`${elBase}/v1/voices/add`, {
                method: 'POST',
                headers: { 'xi-api-key': elKey },
                body: fd,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail?.message || err.detail || `HTTP ${res.status}`);
            }
            const { voice_id } = await res.json();
            setName('');
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
            await loadMyVoices();
            if (onVoiceCreated) onVoiceCreated(voice_id);
        } catch (e) { alert(`Clone failed: ${e.message}`); }
        finally { setCloning(false); }
    };

    const deleteVoice = async (voiceId, voiceName) => {
        if (!confirm(`Delete voice "${voiceName}" from your ElevenLabs account?`)) return;
        const elKey = getElKey();
        if (!elKey) return;
        try {
            await fetch(`${elBase}/v1/voices/${voiceId}`, {
                method: 'DELETE',
                headers: { 'xi-api-key': elKey },
            });
            setMyVoices(v => v.filter(x => x.voice_id !== voiceId));
        } catch (e) { alert(`Delete failed: ${e.message}`); }
    };

    const previewVoice = async (voiceId) => {
        const elKey = getElKey();
        if (!elKey) { alert('ElevenLabs API key not found — go to ⚙ Settings.'); return; }
        setPreviewing(voiceId);
        try {
            const blob = await elGenerateSpeech(elKey, { voiceId, text: sampleText });
            const url = URL.createObjectURL(blob);
            if (audioRef.current) { audioRef.current.src = url; audioRef.current.play(); }
        } catch (e) { alert(`Preview failed: ${e.message}`); }
        finally { setPreviewing(null); }
    };

    return (
        <div className="flex flex-col gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">🎤 Clone Voice</h3>
                <p className="text-[10px] text-white/30">Instant Voice Cloning via ElevenLabs</p>
            </div>

            {/* Clone form */}
            <div className="flex flex-col gap-2">
                <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="Voice name (e.g. John Speaker)"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-[#d9ff00]/40" />

                <input ref={fileRef} type="file"
                    accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac,audio/webm,video/mp4,video/quicktime,video/webm,.mp3,.mp4,.wav,.m4a,.ogg,.flac,.mov,.webm"
                    className="hidden"
                    onChange={e => setFile(e.target.files?.[0] || null)} />

                {file ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#d9ff00]/5 border border-[#d9ff00]/20">
                        <span className="text-[10px] text-[#d9ff00] flex-1 truncate">📎 {file.name}</span>
                        <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                            className="text-white/30 hover:text-red-400 text-xs transition-colors flex-shrink-0">✕</button>
                    </div>
                ) : (
                    <button onClick={() => fileRef.current?.click()} className={`${btnGhost} w-full`}>
                        ⬆ Upload audio or video file
                    </button>
                )}
                <p className="text-[9px] text-white/20">Supports MP3, WAV, M4A, OGG, FLAC, MP4, MOV · min 1 min of clear speech</p>

                <button onClick={cloneVoice} disabled={cloning || !file || !name.trim()} className={`${btnPrimary} w-full`}>
                    {cloning ? '⏳ Cloning…' : '🎤 Create Cloned Voice'}
                </button>
            </div>

            {/* Existing cloned voices */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-white/50">Your Cloned Voices</span>
                    <button onClick={loadMyVoices} disabled={loadingList} className="text-[10px] text-white/30 hover:text-white transition-colors">
                        {loadingList ? '⏳' : '↺ Refresh'}
                    </button>
                </div>

                <div>
                    <label className="text-[10px] text-white/30 mb-1 block">Preview sample text</label>
                    <input value={sampleText} onChange={e => setSampleText(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-[#d9ff00]/40" />
                </div>

                {myVoices.length === 0 ? (
                    <p className="text-[10px] text-white/20 text-center py-3">
                        {loadingList ? 'Loading…' : 'No cloned voices yet — create one above.'}
                    </p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {myVoices.map(v => (
                            <div key={v.voice_id}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="text-xs font-bold text-white truncate">{v.name}</span>
                                    <span className="text-[9px] text-white/25 truncate font-mono">{v.voice_id}</span>
                                </div>
                                <button onClick={() => previewVoice(v.voice_id)} disabled={previewing === v.voice_id}
                                    className={`${btnGhost} px-2.5 flex-shrink-0 text-[11px]`}>
                                    {previewing === v.voice_id ? '⏳' : '▶'}
                                </button>
                                <button onClick={() => deleteVoice(v.voice_id, v.name)}
                                    className="text-white/20 hover:text-red-400 text-xs transition-colors flex-shrink-0 px-1">
                                    🗑
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <audio ref={audioRef} className="hidden" />
            </div>
        </div>
    );
}

// ─── V2VAdmin ─────────────────────────────────────────────────────────────────

function V2VAdmin() {
    const [rewriterPrompt,    setRewriterPrompt]    = useState('');
    const [rewriterDefault,   setRewriterDefault]   = useState('');
    const [imagePrompt,       setImagePrompt]       = useState('');
    const [imageDefault,      setImageDefault]      = useState('');
    const [voices,            setVoices]            = useState([]);
    const [selectedVoice,     setSelectedVoice]     = useState('');
    const [sampleText,        setSampleText]        = useState('Hello, this is a quick preview of how I\'ll sound.');
    const [saving,            setSaving]            = useState({});
    const [toast,             setToast]             = useState('');

    useEffect(() => {
        v2vFetch('/api/jobs/prompts/rewriter').then(d => { setRewriterPrompt(d.prompt || ''); setRewriterDefault(d.default || ''); }).catch(() => {});
        v2vFetch('/api/jobs/prompts/image').then(d => { setImagePrompt(d.prompt || ''); setImageDefault(d.default || ''); }).catch(() => {});
        v2vFetch('/api/jobs/voices').then(d => setVoices(d.voices || [])).catch(() => {});
        v2vFetch('/api/jobs/voice').then(d => setSelectedVoice(d.voice_id || '')).catch(() => {});
    }, []);

    const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

    const savePrompt = async (type, prompt) => {
        setSaving(s => ({ ...s, [type]: true }));
        try {
            await v2vFetch(`/api/jobs/prompts/${type}`, { method: 'PUT', body: JSON.stringify({ prompt }) });
            showToast(`${type} prompt saved`);
        } catch (e) { showToast(`Error: ${e.message}`); }
        finally { setSaving(s => ({ ...s, [type]: false })); }
    };

    const selectVoice = async (voiceId) => {
        setSaving(s => ({ ...s, voice: true }));
        try {
            await v2vFetch('/api/jobs/voice', { method: 'PUT', body: JSON.stringify({ voice_id: voiceId }) });
            setSelectedVoice(voiceId);
            showToast('Voice saved');
        } catch (e) { showToast(`Error: ${e.message}`); }
        finally { setSaving(s => ({ ...s, voice: false })); }
    };

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            <div className="max-w-2xl mx-auto flex flex-col gap-6">
                <div>
                    <h2 className="text-lg font-black text-white">Admin Control</h2>
                    <p className="text-xs text-white/30 mt-1">Configure AI prompts, voice, and lipsync settings for the pipeline.</p>
                </div>

                {toast && <div className="px-4 py-2 rounded-lg bg-[#d9ff00]/10 border border-[#d9ff00]/20 text-xs text-[#d9ff00]">{toast}</div>}

                <PromptEditor title="Text Rewriter Prompt" value={rewriterPrompt} defaultValue={rewriterDefault}
                    onChange={setRewriterPrompt} onSave={() => savePrompt('rewriter', rewriterPrompt)}
                    onReset={() => setRewriterPrompt(rewriterDefault)} saving={saving.rewriter} />

                <PromptEditor title="Image Generator Prompt" value={imagePrompt} defaultValue={imageDefault}
                    onChange={setImagePrompt} onSave={() => savePrompt('image', imagePrompt)}
                    onReset={() => setImagePrompt(imageDefault)} saving={saving.image} />

                {voices.length > 0 && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white">ElevenLabs Voice</h3>
                            {saving.voice && <span className="text-[10px] text-white/30 animate-pulse">Saving…</span>}
                        </div>
                        <div>
                            <label className="text-[10px] text-white/40 mb-1 block">Sample text for preview</label>
                            <input value={sampleText} onChange={e => setSampleText(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {voices.map(v => (
                                <VoiceCard key={v.voice_id} voice={v} selected={v.voice_id === selectedVoice}
                                    onSelect={selectVoice} sampleText={sampleText} />
                            ))}
                        </div>
                        <p className="text-[10px] text-white/20">Voice is used for ElevenLabs TTS in the Higgsfield lipsync pipeline. Veo 3 generates its own voice.</p>
                    </div>
                )}

                <VoiceCloner onVoiceCreated={(voiceId) => showToast(`Voice cloned! ID: ${voiceId}`)} />

                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <p className="text-[11px] text-white/30 font-bold mb-1">Backend URL</p>
                    <p className="text-xs text-white/50 font-mono">{getBackendUrl()}</p>
                    <p className="text-[10px] text-white/20 mt-2">
                        Change in ⚙ Settings → Video-to-Video Backend.
                        Run: <code className="text-white/40 bg-white/[0.05] px-1 rounded">cd /tmp/v2v/backend && uvicorn app.main:app --reload</code>
                    </p>
                </div>
            </div>
        </div>
    );
}

// ─── V2VStudio ────────────────────────────────────────────────────────────────

export default function V2VStudio() {
    const [subPage, setSubPage]   = useState('studio');
    const [backendOk, setBackendOk] = useState(null);

    useEffect(() => {
        v2vFetch('/health').then(() => setBackendOk(true)).catch(() => setBackendOk(false));
    }, []);

    return (
        <div className="w-full h-full flex flex-col overflow-hidden bg-[#0a0a0a]">
            {/* Sub-nav */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-white/[0.06] flex-shrink-0">
                {[{ id: 'studio', label: '🎬 Studio' }, { id: 'admin', label: '⚙ Admin Control' }].map(p => (
                    <button key={p.id} onClick={() => setSubPage(p.id)}
                        className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-all ${
                            subPage === p.id ? 'bg-[#d9ff00] text-black' : 'text-white/40 hover:text-white'
                        }`}>{p.label}</button>
                ))}
                <div className="ml-auto mb-2 flex items-center gap-1.5">
                    {backendOk === true  && <span className="text-[10px] text-green-400 font-bold">● Backend online</span>}
                    {backendOk === false && <span className="text-[10px] text-red-400 font-bold" title={getBackendUrl()}>✕ Backend offline</span>}
                </div>
            </div>

            {subPage === 'studio' ? <V2VMain /> : <V2VAdmin />}
        </div>
    );
}
