"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import OverlayCanvas from './canv/OverlayCanvas';
import Timeline from './canv/Timeline';
import AudioMixer from './canv/AudioMixer';
import VideoMerger from './canv/VideoMerger';
import CaptionOverlay, { parseCaptionFile } from './canv/CaptionOverlay';
import ClipOverlaysLayer from './canv/ClipOverlaysLayer';
import { saveCanvSession, loadCanvSession, clearCanvSession } from './canv/canvSession';

const BG_COLORS = [
    { id: 'black', hex: '#000000', label: 'Black'  },
    { id: 'white', hex: '#ffffff', label: 'White'  },
    { id: 'dark',  hex: '#111111', label: 'Dark'   },
    { id: 'navy',  hex: '#0f172a', label: 'Navy'   },
    { id: 'green', hex: '#052e16', label: 'Forest' },
    { id: 'none',  hex: '',        label: 'None'   },
];

const BG_PRESETS = [
    { label: 'Dark', value: 'rgba(0,0,0,0.72)'     },
    { label: 'Semi', value: 'rgba(0,0,0,0.40)'     },
    { label: 'None', value: 'transparent'           },
    { label: 'Pop',  value: 'rgba(217,255,0,0.85)' },
];

const CANVAS_W = 896;
const CANVAS_H = 504; // 16:9

const uid = () => `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── CollapsibleSection ────────────────────────────────────────────────────────

function CollapsibleSection({ title, badge, defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-white/[0.04]">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.02] transition-colors"
            >
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{title}</span>
                    {badge != null && badge > 0 && (
                        <span className="text-[9px] px-1.5 rounded-full bg-[#d9ff00]/20 text-[#d9ff00] font-bold">{badge}</span>
                    )}
                </div>
                <span className="text-white/20 text-[10px]">{open ? '▼' : '▶'}</span>
            </button>
            {open && <div className="pb-3 px-3">{children}</div>}
        </div>
    );
}

// ── CaptionsPanel ─────────────────────────────────────────────────────────────

const MODEL_INFO = {
    base:  { label: 'Base',  note: '~74 MB · recommended'    },
    small: { label: 'Small', note: '~244 MB · most accurate' },
};

const HL_STYLES = [
    { id: 'color',     label: 'Color'     },
    { id: 'box',       label: 'Box'       },
    { id: 'underline', label: 'Line'      },
    { id: 'bold',      label: 'Bold'      },
];

function CaptionsPanel({ captions, onChange, videoUrl, selectedCapId, onSelectCap }) {
    // Global style defaults
    const [size,      setSize]      = useState('md');
    const [color,     setColor]     = useState('#ffffff');
    const [bg,        setBg]        = useState('rgba(0,0,0,0.72)');
    // Highlight defaults
    const [hlEnabled, setHlEnabled] = useState(false);
    const [hlColor,   setHlColor]   = useState('#d9ff00');
    const [hlStyle,   setHlStyle]   = useState('color');
    // Generation
    const [modelSize, setModelSize] = useState('base');
    const [generating,setGenerating]= useState(false);
    const [genMsg,    setGenMsg]    = useState('');

    const mkCap = (t, s, e) => ({
        id: uid(), text: t, start: s, end: e,
        x: 50, y: 90, size, color, bg,
        highlight: hlEnabled, highlightColor: hlColor, highlightStyle: hlStyle,
    });

    const generateCaptions = async () => {
        if (!videoUrl) return;
        setGenerating(true); setGenMsg('Fetching video…');
        try {
            const blob = await fetch(videoUrl).then(r => r.blob());
            setGenMsg('Transcribing… (first run downloads the model)');
            const backendUrl = (typeof window !== 'undefined'
                ? localStorage.getItem('v2v_backend_url') || 'http://localhost:8000'
                : 'http://localhost:8000').replace(/\/$/, '');
            const fd = new FormData();
            fd.append('file', blob, 'video.mp4');
            fd.append('model', modelSize);
            const res = await fetch('/api/v2v/api/transcribe', {
                method: 'POST',
                headers: { 'x-v2v-backend': backendUrl },
                body: fd,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(err.detail || res.statusText);
            }
            const data = await res.json();
            const newCaps = (data.segments || []).map(s => ({
                ...mkCap(s.text, s.start, s.end),
                words: s.words || null,
            }));
            onChange([...captions, ...newCaps]);
            setGenMsg(`✓ ${newCaps.length} captions · ${data.language} (${Math.round((data.language_probability || 0) * 100)}%)`);
            setTimeout(() => setGenMsg(''), 4000);
        } catch (e) {
            setGenMsg(`✕ ${e.message}`);
            setTimeout(() => setGenMsg(''), 6000);
        } finally {
            setGenerating(false);
        }
    };

    const del       = (id) => { onChange(captions.filter(c => c.id !== id)); if (selectedCapId === id) onSelectCap(null); };
    const clearAll  = ()   => { onChange([]); onSelectCap(null); };
    const updateCap = (id, patch) => onChange(captions.map(c => c.id === id ? { ...c, ...patch } : c));

    const applyStyleToAll = () => {
        if (!captions.length) return;
        onChange(captions.map(c => ({
            ...c, size, color, bg,
            highlight: hlEnabled, highlightColor: hlColor, highlightStyle: hlStyle,
        })));
    };

    return (
        <div className="flex flex-col gap-2.5">

            {/* ── Auto-Generate ── */}
            <div className={`flex flex-col gap-2 p-2.5 rounded-xl border ${videoUrl ? 'border-[#d9ff00]/20 bg-[#d9ff00]/[0.03]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white/60">✦ Auto-Generate</span>
                    {!videoUrl && <span className="text-[9px] text-white/25">Load a video first</span>}
                </div>
                <div className="flex gap-1">
                    {Object.entries(MODEL_INFO).map(([key, info]) => (
                        <button key={key} onClick={() => setModelSize(key)} disabled={generating}
                            title={info.note}
                            className={`flex-1 py-1 rounded text-[9px] font-bold transition-all ${modelSize === key ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                            {info.label}
                        </button>
                    ))}
                </div>
                <p className="text-[9px] text-white/20 -mt-1">{MODEL_INFO[modelSize].note}</p>
                <button onClick={generateCaptions} disabled={!videoUrl || generating}
                    className={`w-full py-2 rounded-lg text-[11px] font-black transition-all ${videoUrl && !generating ? 'bg-[#d9ff00] text-black hover:bg-[#e5ff33]' : 'bg-white/5 text-white/20 cursor-not-allowed'}`}>
                    {generating ? '⏳ Transcribing…' : '✦ Generate Captions'}
                </button>
                {genMsg && (
                    <p className={`text-[9px] leading-relaxed ${genMsg.startsWith('✕') ? 'text-red-400' : 'text-[#d9ff00]/70'}`}>{genMsg}</p>
                )}
            </div>

            {/* ── Global style — applies to all ── */}
            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Style — applies to all</span>
                    {captions.length > 0 && (
                        <button onClick={applyStyleToAll}
                            className="px-2.5 py-1 rounded-lg bg-[#d9ff00] text-black text-[9px] font-black hover:bg-[#e5ff33] transition-all">
                            Go ↑
                        </button>
                    )}
                </div>

                {/* Size */}
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white/30 w-8 flex-shrink-0">Size</span>
                    <div className="flex gap-1 flex-1">
                        {['sm','md','lg'].map(s => (
                            <button key={s} onClick={() => setSize(s)}
                                className={`flex-1 py-0.5 rounded text-[9px] font-bold uppercase transition-all ${size === s ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                                {s}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Text color */}
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white/30 w-8 flex-shrink-0">Color</span>
                    <input type="color" value={color} onChange={e => setColor(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border border-white/10 bg-transparent flex-shrink-0" />
                    <span className="text-[9px] text-white/20 font-mono">{color}</span>
                </div>

                {/* Background */}
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white/30 w-8 flex-shrink-0">BG</span>
                    <div className="flex gap-1 flex-1">
                        {BG_PRESETS.map(p => (
                            <button key={p.label} onClick={() => setBg(p.value)}
                                className={`flex-1 py-0.5 rounded text-[9px] font-bold transition-all ${bg === p.value ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Word highlight ── */}
                <div className="border-t border-white/[0.06] pt-1.5 mt-0.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] text-white/30">✦ Word Highlight</span>
                        <button
                            onClick={() => setHlEnabled(v => !v)}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${hlEnabled ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/20 hover:text-white'}`}>
                            {hlEnabled ? 'On' : 'Off'}
                        </button>
                    </div>
                    {hlEnabled && (
                        <>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-white/30 w-8 flex-shrink-0">Color</span>
                                <input type="color" value={hlColor} onChange={e => setHlColor(e.target.value)}
                                    className="w-7 h-6 rounded cursor-pointer border border-white/10 bg-transparent flex-shrink-0" />
                                <span className="text-[9px] text-white/20 font-mono">{hlColor}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-white/30 w-8 flex-shrink-0">Style</span>
                                <div className="flex gap-0.5 flex-1">
                                    {HL_STYLES.map(s => (
                                        <button key={s.id} onClick={() => setHlStyle(s.id)}
                                            className={`flex-1 py-0.5 rounded text-[9px] font-bold transition-all ${hlStyle === s.id ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                                            {s.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <p className="text-[8px] text-white/20 leading-relaxed">Words are highlighted live using timestamps from Auto-Generate</p>
                        </>
                    )}
                </div>
            </div>

            {/* ── Caption list ── */}
            {captions.length > 0 ? (
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[9px] text-white/30">{captions.length} caption{captions.length !== 1 ? 's' : ''}</span>
                        <button onClick={clearAll} className="text-[9px] text-white/20 hover:text-red-400 transition-colors">Clear all</button>
                    </div>
                    <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {captions.map(c => (
                            <div key={c.id} className="flex flex-col gap-0.5">
                                {/* Row */}
                                <button
                                    onClick={() => onSelectCap(c.id === selectedCapId ? null : c.id)}
                                    className={`w-full text-left flex items-start gap-1.5 px-2 py-1.5 rounded-lg transition-all ${
                                        c.id === selectedCapId
                                            ? 'bg-[#d9ff00]/10 border border-[#d9ff00]/30'
                                            : 'bg-white/[0.03] border border-white/[0.05] hover:border-white/10'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[10px] truncate ${c.id === selectedCapId ? 'text-[#d9ff00]' : 'text-white/80'}`}>{c.text}</p>
                                        <p className="text-[9px] text-white/25">{c.start.toFixed(1)}s–{c.end.toFixed(1)}s · x{Math.round(c.x ?? 50)} y{Math.round(c.y ?? 90)}{c.highlight && c.words ? ' ✦' : ''}</p>
                                    </div>
                                    <span onClick={e => { e.stopPropagation(); del(c.id); }}
                                        className="text-white/20 hover:text-red-400 text-[10px] transition-colors flex-shrink-0 mt-0.5 cursor-pointer">✕</span>
                                </button>

                                {/* Inline editor */}
                                {c.id === selectedCapId && (
                                    <div className="p-2 rounded-lg bg-[#d9ff00]/[0.03] border border-[#d9ff00]/10 flex flex-col gap-1.5">
                                        <span className="text-[9px] text-[#d9ff00]/50 font-bold uppercase tracking-widest">Drag on canvas · or use sliders</span>

                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] text-white/30 w-3">X</span>
                                            <input type="range" min="2" max="98" value={Math.round(c.x ?? 50)}
                                                onChange={e => updateCap(c.id, { x: parseInt(e.target.value) })}
                                                className="flex-1 h-1 accent-[#d9ff00]" />
                                            <span className="text-[9px] text-white/30 w-6 text-right">{Math.round(c.x ?? 50)}%</span>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] text-white/30 w-3">Y</span>
                                            <input type="range" min="2" max="98" value={Math.round(c.y ?? 90)}
                                                onChange={e => updateCap(c.id, { y: parseInt(e.target.value) })}
                                                className="flex-1 h-1 accent-[#d9ff00]" />
                                            <span className="text-[9px] text-white/30 w-6 text-right">{Math.round(c.y ?? 90)}%</span>
                                        </div>

                                        <div className="flex gap-1">
                                            {[['Top', 8], ['Mid', 50], ['Bot', 88]].map(([label, val]) => (
                                                <button key={label} onClick={() => updateCap(c.id, { y: val })}
                                                    className={`flex-1 py-0.5 rounded text-[9px] font-bold transition-all ${Math.round(c.y ?? 90) === val ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <div className="flex gap-0.5 flex-1">
                                                {['sm','md','lg'].map(s => (
                                                    <button key={s} onClick={() => updateCap(c.id, { size: s })}
                                                        className={`flex-1 py-0.5 rounded text-[9px] font-bold uppercase transition-all ${c.size === s ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                            <input type="color" value={c.color || '#ffffff'}
                                                onChange={e => updateCap(c.id, { color: e.target.value })}
                                                className="w-7 h-6 rounded cursor-pointer border border-white/10 bg-transparent flex-shrink-0" />
                                        </div>

                                        <div className="flex gap-0.5">
                                            {BG_PRESETS.map(p => (
                                                <button key={p.label} onClick={() => updateCap(c.id, { bg: p.value })}
                                                    className={`flex-1 py-0.5 rounded text-[9px] font-bold transition-all ${c.bg === p.value ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/30 hover:text-white'}`}>
                                                    {p.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Per-caption highlight toggle */}
                                        {c.words && (
                                            <div className="flex items-center gap-2 pt-0.5 border-t border-white/[0.06]">
                                                <span className="text-[9px] text-white/30 flex-1">✦ Word Highlight</span>
                                                <button onClick={() => updateCap(c.id, { highlight: !c.highlight })}
                                                    className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${c.highlight ? 'bg-[#d9ff00]/20 text-[#d9ff00] border border-[#d9ff00]/30' : 'border border-white/10 text-white/20 hover:text-white'}`}>
                                                    {c.highlight ? 'On' : 'Off'}
                                                </button>
                                                {c.highlight && (
                                                    <input type="color" value={c.highlightColor || '#d9ff00'}
                                                        onChange={e => updateCap(c.id, { highlightColor: e.target.value })}
                                                        className="w-6 h-6 rounded cursor-pointer border border-white/10 bg-transparent" />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <p className="text-[10px] text-white/20">Generate captions from your video above</p>
            )}
        </div>
    );
}

// ── ClipsPanel ────────────────────────────────────────────────────────────────

function ClipsPanel({ clips, currentTime, duration, onChange }) {
    const [lottieUrl,  setLottieUrl]  = useState('');
    const [showLottie, setShowLottie] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const videoRef = useRef(null);

    const addVideoClip = (file) => {
        const type = file.type.includes('gif') ? 'gif' : 'video';
        const url  = URL.createObjectURL(file);
        const clip = {
            id: uid(), type, url, label: file.name.replace(/\.[^.]+$/, ''),
            x: Math.round(CANVAS_W * 0.25), y: Math.round(CANVAS_H * 0.25),
            w: Math.round(CANVAS_W * 0.5),  h: Math.round(CANVAS_H * 0.5),
            startTime: 0, endTime: Math.min(duration || 30, 5),
            opacity: 1, loop: true, rounded: false,
        };
        onChange([...clips, clip]);
        setSelectedId(clip.id);
    };

    const addLottie = () => {
        if (!lottieUrl.trim()) return;
        const clip = {
            id: uid(), type: 'lottie', url: lottieUrl.trim(), label: 'Lottie',
            x: Math.round(CANVAS_W * 0.3), y: Math.round(CANVAS_H * 0.2),
            w: 200, h: 200,
            startTime: 0, endTime: Math.min(duration || 30, 5),
            opacity: 1, loop: true,
        };
        onChange([...clips, clip]);
        setSelectedId(clip.id);
        setLottieUrl(''); setShowLottie(false);
    };

    const del    = (id) => { onChange(clips.filter(c => c.id !== id)); if (selectedId === id) setSelectedId(null); };
    const update = (id, patch) => onChange(clips.map(c => c.id === id ? { ...c, ...patch } : c));
    const sel    = clips.find(c => c.id === selectedId);

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 text-[11px] text-white/60 hover:text-white hover:border-white/30 cursor-pointer transition-all">
                    🎞 Upload Video / GIF
                    <input ref={videoRef} type="file" accept="video/*,image/gif" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) addVideoClip(f); e.target.value = ''; }} />
                </label>
                <button onClick={() => setShowLottie(v => !v)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${showLottie ? 'border-[#d9ff00]/30 text-[#d9ff00]' : 'border-white/10 text-white/60 hover:text-white hover:border-white/30'}`}>
                    ✦ Add Lottie Animation
                </button>
                {showLottie && (
                    <div className="flex gap-1">
                        <input value={lottieUrl} onChange={e => setLottieUrl(e.target.value)}
                            placeholder="LottieFiles JSON URL…"
                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white font-mono outline-none focus:border-[#d9ff00]/40 min-w-0" />
                        <button onClick={addLottie} className="px-2.5 py-1 rounded bg-[#d9ff00] text-black text-[10px] font-black hover:bg-[#e5ff33]">+</button>
                    </div>
                )}
            </div>

            {clips.length === 0 && (
                <p className="text-[10px] text-white/20">Upload a short clip or GIF to overlay on your video</p>
            )}
            {clips.length > 0 && (
                <div className="flex flex-col gap-1">
                    {clips.map(c => (
                        <button key={c.id} onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                            className={`text-left px-2.5 py-1.5 rounded-lg text-xs transition-all ${selectedId === c.id ? 'bg-[#d9ff00]/10 border border-[#d9ff00]/30 text-[#d9ff00]' : 'border border-white/5 text-white/50 hover:text-white hover:border-white/20'}`}>
                            <div className="flex items-center justify-between">
                                <span className="truncate font-medium">{c.label}</span>
                                <span onClick={e => { e.stopPropagation(); del(c.id); }} className="text-white/20 hover:text-red-400 transition-colors ml-1 cursor-pointer">✕</span>
                            </div>
                            <span className="text-[9px] text-white/30">{c.type} · {c.startTime.toFixed(1)}s–{c.endTime.toFixed(1)}s</span>
                        </button>
                    ))}
                </div>
            )}

            {sel && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.06]">
                    <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Clip Options</span>
                    <div className="flex gap-1">
                        <div className="flex-1">
                            <label className="text-[9px] text-white/30 block mb-0.5">Start s</label>
                            <input type="number" value={sel.startTime} min="0" step="0.1"
                                onChange={e => update(sel.id, { startTime: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                        <div className="flex-1">
                            <label className="text-[9px] text-white/30 block mb-0.5">End s</label>
                            <input type="number" value={sel.endTime} min="0" step="0.1"
                                onChange={e => update(sel.id, { endTime: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <div className="flex-1">
                            <label className="text-[9px] text-white/30 block mb-0.5">X px</label>
                            <input type="number" value={sel.x} step="1"
                                onChange={e => update(sel.id, { x: parseInt(e.target.value) || 0 })}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                        <div className="flex-1">
                            <label className="text-[9px] text-white/30 block mb-0.5">Y px</label>
                            <input type="number" value={sel.y} step="1"
                                onChange={e => update(sel.id, { y: parseInt(e.target.value) || 0 })}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <div className="flex-1">
                            <label className="text-[9px] text-white/30 block mb-0.5">W px</label>
                            <input type="number" value={sel.w} step="1" min="10"
                                onChange={e => update(sel.id, { w: parseInt(e.target.value) || 10 })}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                        <div className="flex-1">
                            <label className="text-[9px] text-white/30 block mb-0.5">H px</label>
                            <input type="number" value={sel.h} step="1" min="10"
                                onChange={e => update(sel.id, { h: parseInt(e.target.value) || 10 })}
                                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#d9ff00]/40" />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] text-white/30 flex-shrink-0">Opacity</span>
                        <input type="range" min="0" max="1" step="0.05" value={sel.opacity ?? 1}
                            onChange={e => update(sel.id, { opacity: parseFloat(e.target.value) })}
                            className="flex-1 h-1 accent-[#d9ff00]" />
                        <span className="text-[9px] text-white/30 w-6">{Math.round((sel.opacity ?? 1) * 100)}%</span>
                    </div>
                    <div className="flex gap-2">
                        <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={sel.loop !== false} onChange={e => update(sel.id, { loop: e.target.checked })}
                                className="w-3 h-3 accent-[#d9ff00]" />
                            <span className="text-[10px] text-white/40">Loop</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={!!sel.rounded} onChange={e => update(sel.id, { rounded: e.target.checked })}
                                className="w-3 h-3 accent-[#d9ff00]" />
                            <span className="text-[10px] text-white/40">Rounded</span>
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── CanvEditor ────────────────────────────────────────────────────────────────

export default function CanvEditor() {
    const videoRef      = useRef(null);
    const canvasRef     = useRef(null);
    const imgInputRef   = useRef(null);
    const canvasAreaRef = useRef(null);

    // Background
    const [bgType,      setBgType]      = useState('color');
    const [bgColor,     setBgColor]     = useState('#000000');
    const [bgImageUrl,  setBgImageUrl]  = useState(null);
    const [bgVideoUrl,  setBgVideoUrl]  = useState(null);
    const [customColor, setCustomColor] = useState('#000000');
    const [showMerger,  setShowMerger]  = useState(false);

    // Overlays (Fabric.js)
    const [overlays, setOverlays] = useState([]);
    const [selOvId,  setSelOvId]  = useState(null);

    // Captions
    const [captions,      setCaptions]      = useState([]);
    const [selectedCapId, setSelectedCapId] = useState(null);

    // Clip overlays
    const [clips, setClips] = useState([]);

    // Playback
    const [currentTime, setCurrentTime] = useState(0);
    const [duration,    setDuration]    = useState(0);
    const [isPlaying,   setIsPlaying]   = useState(false);

    // Canvas display size — fits available space maintaining 16:9
    const [displaySize,  setDisplaySize]  = useState({ w: CANVAS_W, h: CANVAS_H });
    const [hideSidebars, setHideSidebars] = useState(false);

    // Session
    const [saveStatus,        setSaveStatus]        = useState('idle'); // 'idle'|'saving'|'saved'
    const sessionInitialized  = useRef(false);
    const saveTimer           = useRef(null);
    const lastSavedUrls       = useRef({});

    // Load session on mount
    useEffect(() => {
        loadCanvSession().then(session => {
            if (!session) { sessionInitialized.current = true; return; }
            setBgType(session.bgType);
            setBgColor(session.bgColor);
            if (session.bgVideoUrl) setBgVideoUrl(session.bgVideoUrl);
            if (session.bgImageUrl) setBgImageUrl(session.bgImageUrl);
            setCaptions(session.captions);
            setClips(session.clips);
            // Apply canvas bg after fabric initialises (small delay)
            setTimeout(() => {
                if (session.bgType === 'image' && session.bgImageUrl) {
                    canvasRef.current?.setBackgroundImage(session.bgImageUrl);
                } else if (session.bgType === 'color') {
                    canvasRef.current?.setBgColor(session.bgColor);
                }
                if (session.fabricSnap) {
                    canvasRef.current?.loadJSON(session.fabricSnap);
                }
            }, 300);
            // Seed the lastSavedUrls so first auto-save doesn't re-upload blobs
            if (session.bgVideoUrl) lastSavedUrls.current.bgVideo = session.bgVideoUrl;
            if (session.bgImageUrl) lastSavedUrls.current.bgImage = session.bgImageUrl;
            session.clips.forEach(c => { if (c.url) lastSavedUrls.current[c.id] = c.url; });
            setSaveStatus('saved');
            sessionInitialized.current = true;
        }).catch(() => { sessionInitialized.current = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-save (debounced 1.5 s) whenever state that matters changes
    const stateSnap = useRef({});
    useEffect(() => {
        stateSnap.current = { bgType, bgColor, bgVideoUrl, bgImageUrl, captions, clips };
    });
    useEffect(() => {
        if (!sessionInitialized.current) return;
        setSaveStatus('saving');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            try {
                await saveCanvSession(stateSnap.current, canvasRef, lastSavedUrls.current);
                setSaveStatus('saved');
            } catch { setSaveStatus('idle'); }
        }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bgType, bgColor, bgVideoUrl, bgImageUrl, captions, clips]);

    const newSession = async () => {
        if (!window.confirm('Start a new canvas? This will clear everything.')) return;
        await clearCanvSession();
        lastSavedUrls.current = {};
        setBgType('color'); setBgColor('#000000');
        setBgImageUrl(null); setBgVideoUrl(null);
        setCaptions([]); setClips([]);
        canvasRef.current?.clearAll();
        canvasRef.current?.setBgColor('#000000');
        setSaveStatus('idle');
    };

    // Recompute display size whenever the canvas area or layout changes
    const updateDisplaySize = useCallback(() => {
        const el = canvasAreaRef.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        if (width < 10 || height < 10) return;
        const availW = width  - 16;
        const availH = height - 16;
        const ratio  = CANVAS_W / CANVAS_H;
        let w, h;
        if (availW / availH >= ratio) {
            h = Math.min(availH, CANVAS_H);
            w = Math.round(h * ratio);
        } else {
            w = Math.min(availW, CANVAS_W);
            h = Math.round(w / ratio);
        }
        setDisplaySize(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
    }, []);

    useLayoutEffect(() => {
        updateDisplaySize();
        const ro = new ResizeObserver(updateDisplaySize);
        if (canvasAreaRef.current) ro.observe(canvasAreaRef.current);
        window.addEventListener('resize', updateDisplaySize);
        return () => { ro.disconnect(); window.removeEventListener('resize', updateDisplaySize); };
    }, [updateDisplaySize, hideSidebars]);

    // Re-measure when video controls appear/disappear
    useEffect(() => { setTimeout(updateDisplaySize, 50); }, [bgVideoUrl, updateDisplaySize]);

    // ── Caption drag ────────────────────────────────────────────────────────
    const moveCaption = useCallback((id, x, y) => {
        setCaptions(prev => prev.map(c => c.id === id ? { ...c, x, y } : c));
    }, []);

    // ── Background helpers ──────────────────────────────────────────────────
    const setImageBg = useCallback((file) => {
        const url = URL.createObjectURL(file);
        setBgImageUrl(url); setBgVideoUrl(null); setBgType('image');
        canvasRef.current?.setBackgroundImage(url);
    }, []);

    const setVideoBg = useCallback((url) => {
        setBgVideoUrl(url); setBgImageUrl(null); setBgType('video');
        canvasRef.current?.setBackgroundImage(null);
        canvasRef.current?.setBgColor('');
    }, []);

    const applyColorBg = useCallback((hex) => {
        setBgColor(hex); setBgType('color'); setBgImageUrl(null); setBgVideoUrl(null);
        canvasRef.current?.setBackgroundImage(null);
        canvasRef.current?.setBgColor(hex);
    }, []);

    // ── Playback ────────────────────────────────────────────────────────────
    const togglePlay = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) { v.play(); setIsPlaying(true); }
        else          { v.pause(); setIsPlaying(false); }
    };
    const handleSeek = useCallback((t) => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = Math.max(0, Math.min(duration, t));
    }, [duration]);

    // ── Toolbar ─────────────────────────────────────────────────────────────
    const addText    = () => canvasRef.current?.addText('Double-click to edit');
    const addLabel   = () => canvasRef.current?.addLabel('Your Label');
    const addRect    = () => canvasRef.current?.addRect();
    const addCircle  = () => canvasRef.current?.addCircle();
    const addImgFile = (e) => { const f = e.target.files?.[0]; if (f) canvasRef.current?.addImage(f); e.target.value = ''; };
    const deleteSelected = () => { canvasRef.current?.removeSelected(); setSelOvId(null); };

    // ── Drag-drop ───────────────────────────────────────────────────────────
    const handleEditorDrop = (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        if (file.type.startsWith('image/')) setImageBg(file);
        else if (file.type.startsWith('video/')) setVideoBg(URL.createObjectURL(file));
    };

    return (
        <div className="h-full flex flex-col bg-[#030303] text-white overflow-hidden select-none">

            {/* ── Top bar ── */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04]">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-black tracking-tight">✂ Canv Editor</span>
                    <span className="text-[9px] text-white/20 font-mono px-1.5 py-0.5 rounded border border-white/10">beta</span>
                </div>

                {/* Overlay toolbar */}
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/30 mr-1">Add:</span>
                    {[
                        { label: 'T',  title: 'Text',   action: addText   },
                        { label: 'Aa', title: 'Label',  action: addLabel  },
                        { label: '▭',  title: 'Rect',   action: addRect   },
                        { label: '◯',  title: 'Circle', action: addCircle },
                    ].map(item => (
                        <button key={item.title} onClick={item.action} title={item.title}
                            className="w-8 h-7 rounded-lg border border-white/10 text-xs font-bold text-white/50 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all">
                            {item.label}
                        </button>
                    ))}
                    <button onClick={() => imgInputRef.current?.click()} title="Add Image"
                        className="h-7 px-2.5 rounded-lg border border-white/10 text-[10px] font-bold text-white/50 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all">
                        🖼 Image
                    </button>
                    <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={addImgFile} />
                    {selOvId && (
                        <button onClick={deleteSelected}
                            className="h-7 px-2.5 rounded-lg border border-red-400/30 text-[10px] font-bold text-red-400 hover:bg-red-400/10 transition-all">
                            ✕ Delete
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Session indicator */}
                    <span className={`text-[9px] font-mono transition-colors ${
                        saveStatus === 'saving' ? 'text-[#d9ff00]/60' :
                        saveStatus === 'saved'  ? 'text-white/20' : 'text-white/10'
                    }`}>
                        {saveStatus === 'saving' ? '⏳ Saving…' : saveStatus === 'saved' ? '● Saved' : ''}
                    </span>
                    <button onClick={newSession} title="New canvas"
                        className="h-7 px-2.5 rounded-lg border border-white/10 text-[10px] font-bold text-white/30 hover:text-white hover:border-white/30 transition-all">
                        ✕ New
                    </button>
                    {/* Expand/collapse sidebars */}
                    <button onClick={() => setHideSidebars(v => !v)}
                        title={hideSidebars ? 'Show panels' : 'Expand canvas'}
                        className={`h-7 px-2.5 rounded-lg border text-[10px] font-bold transition-all ${hideSidebars ? 'border-[#d9ff00]/30 text-[#d9ff00] bg-[#d9ff00]/5' : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'}`}>
                        {hideSidebars ? '⊡ Panels' : '⛶ Expand'}
                    </button>
                    {bgVideoUrl && (
                        <a href={bgVideoUrl} download="canveditor.mp4"
                            className="text-xs px-3 py-1.5 rounded-lg bg-[#d9ff00] text-black font-black hover:bg-[#e5ff33] transition-all">
                            ↓ Export
                        </a>
                    )}
                </div>
            </div>

            {/* ── Main area ── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* ── LEFT sidebar ── */}
                {!hideSidebars && (
                    <div className="w-[240px] flex-shrink-0 flex flex-col border-r border-white/[0.04] overflow-y-auto custom-scrollbar">

                        <CollapsibleSection title="Background">
                            <div className="flex flex-col gap-1.5 mb-3">
                                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:text-white hover:border-white/30 cursor-pointer transition-all">
                                    🖼 Upload Image
                                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setImageBg(f); e.target.value = ''; }} />
                                </label>
                                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-xs text-white/60 hover:text-white hover:border-white/30 cursor-pointer transition-all">
                                    🎬 Upload Video
                                    <input type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setVideoBg(URL.createObjectURL(f)); e.target.value = ''; }} />
                                </label>
                                <button onClick={() => setShowMerger(v => !v)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${showMerger ? 'border-[#d9ff00]/30 text-[#d9ff00] bg-[#d9ff00]/5' : 'border-white/10 text-white/60 hover:text-white hover:border-white/30'}`}>
                                    ✂ Merge 2 Videos
                                </button>
                            </div>
                            {showMerger && (
                                <div className="mb-3 p-2 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                    <VideoMerger onMerged={(url) => { setVideoBg(url); setShowMerger(false); }} />
                                </div>
                            )}
                            <span className="text-[10px] text-white/30 block mb-1.5">Solid Color</span>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {BG_COLORS.map(c => (
                                    <button key={c.id} onClick={() => applyColorBg(c.hex)} title={c.label}
                                        className={`w-6 h-6 rounded-md border-2 transition-all ${bgType === 'color' && bgColor === c.hex ? 'border-[#d9ff00] scale-110' : 'border-white/10 hover:border-white/40'}`}
                                        style={{ background: c.hex || 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 0 0 / 8px 8px' }} />
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="color" value={customColor} onChange={e => setCustomColor(e.target.value)}
                                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
                                <button onClick={() => applyColorBg(customColor)}
                                    className="flex-1 text-[10px] font-bold text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-md py-1 transition-all">
                                    Apply custom
                                </button>
                            </div>
                            {(bgImageUrl || bgVideoUrl) && (
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="text-[10px] text-[#d9ff00]/60">{bgType === 'image' ? '🖼 Image BG' : '🎬 Video BG'}</span>
                                    <button onClick={() => { setBgImageUrl(null); setBgVideoUrl(null); setBgType('color'); canvasRef.current?.setBackgroundImage(null); applyColorBg('#000000'); }}
                                        className="text-[10px] text-white/20 hover:text-red-400 transition-colors">Clear</button>
                                </div>
                            )}
                        </CollapsibleSection>

                        <CollapsibleSection title="Captions" badge={captions.length} defaultOpen={false}>
                            <CaptionsPanel
                                captions={captions}
                                onChange={setCaptions}
                                videoUrl={bgVideoUrl}
                                selectedCapId={selectedCapId}
                                onSelectCap={setSelectedCapId}
                            />
                        </CollapsibleSection>

                        <CollapsibleSection title="Clip Overlays" badge={clips.length} defaultOpen={false}>
                            <ClipsPanel clips={clips} currentTime={currentTime} duration={duration} onChange={setClips} />
                        </CollapsibleSection>

                        <CollapsibleSection title="Layers" badge={overlays.length > 0 ? overlays.length : null} defaultOpen={true}>
                            {overlays.length === 0 ? (
                                <p className="text-[10px] text-white/20 leading-relaxed">Add text, shapes or images using the toolbar above</p>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {[...overlays].reverse().map(ov => (
                                        <button key={ov.id} onClick={() => setSelOvId(ov.id)}
                                            className={`text-left px-2.5 py-1.5 rounded-lg text-xs transition-all ${selOvId === ov.id ? 'bg-[#d9ff00]/10 border border-[#d9ff00]/30 text-[#d9ff00]' : 'border border-white/5 text-white/50 hover:text-white hover:border-white/20'}`}>
                                            <span className="font-medium truncate block">{ov.label}</span>
                                            <span className="text-[9px] text-white/25">{ov.startTime.toFixed(1)}s – {ov.endTime > 990 ? '∞' : ov.endTime.toFixed(1) + 's'}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </CollapsibleSection>
                    </div>
                )}

                {/* ── CENTER ── */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">

                    {/* Canvas area — fills all available space */}
                    <div ref={canvasAreaRef}
                        className="flex-1 min-h-0 flex items-center justify-center bg-[#050505] overflow-hidden p-2"
                        onDragOver={e => e.preventDefault()} onDrop={handleEditorDrop}>

                        {/* Canvas renders at the measured display size — no CSS transform needed */}
                        <div
                            data-caption-canvas
                            style={{ position: 'relative', width: displaySize.w, height: displaySize.h, flexShrink: 0 }}
                            className="shadow-2xl"
                        >
                            {/* Background */}
                            {bgType === 'video' && bgVideoUrl ? (
                                <video ref={videoRef} src={bgVideoUrl}
                                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 1 }}
                                    onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                                    onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                                    onPlay={() => setIsPlaying(true)}
                                    onPause={() => setIsPlaying(false)}
                                    onEnded={() => setIsPlaying(false)} />
                            ) : (
                                <div style={{ position: 'absolute', inset: 0, background: bgColor || '#000', zIndex: 1 }} />
                            )}

                            {/* Fabric.js at actual display size */}
                            <OverlayCanvas ref={canvasRef}
                                width={displaySize.w} height={displaySize.h}
                                currentTime={currentTime}
                                bgColor={bgType === 'image' ? bgColor : undefined}
                                onOverlaysChange={setOverlays} />

                            {/* Clip overlays scaled from logical CANVAS_W/H to display size */}
                            <ClipOverlaysLayer
                                clips={clips}
                                currentTime={currentTime}
                                scaleX={displaySize.w / CANVAS_W}
                                scaleY={displaySize.h / CANVAS_H}
                            />

                            {/* Captions — percentage-based positions, scale-independent */}
                            <CaptionOverlay
                                captions={captions}
                                currentTime={currentTime}
                                selectedId={selectedCapId}
                                onMove={moveCaption}
                            />

                            {!bgImageUrl && !bgVideoUrl && overlays.length === 0 && captions.length === 0 && clips.length === 0 && (
                                <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}
                                    className="flex flex-col items-center justify-center gap-3 opacity-20">
                                    <span className="text-5xl">✂</span>
                                    <span className="text-sm font-bold">Drop an image or video here</span>
                                    <span className="text-xs">or use the controls on the left</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Video controls */}
                    {bgType === 'video' && bgVideoUrl && (
                        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-t border-white/[0.04] bg-black/20">
                            <button onClick={togglePlay}
                                className="w-8 h-8 rounded-full bg-[#d9ff00] text-black flex items-center justify-center font-black text-sm hover:bg-[#e5ff33] transition-all flex-shrink-0">
                                {isPlaying ? '⏸' : '▶'}
                            </button>
                            <span className="text-xs text-white/40 font-mono w-24 flex-shrink-0">
                                {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                            </span>
                            <div className="flex-1 h-1.5 bg-white/10 rounded-full cursor-pointer" onClick={e => {
                                const r = e.currentTarget.getBoundingClientRect();
                                handleSeek(((e.clientX - r.left) / r.width) * duration);
                            }}>
                                <div className="h-full bg-[#d9ff00] rounded-full"
                                    style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }} />
                            </div>
                        </div>
                    )}

                    {/* Timeline */}
                    <div className="flex-shrink-0 p-3 border-t border-white/[0.04] bg-black/10">
                        <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest block mb-2">Timeline</span>
                        <Timeline
                            overlays={overlays}
                            duration={duration || 30}
                            currentTime={currentTime}
                            onSeek={handleSeek}
                            onUpdateTiming={(id, s, e) => {
                                canvasRef.current?.updateTiming(id, s, e);
                                setOverlays(prev => prev.map(o => o.id === id ? { ...o, startTime: s, endTime: e } : o));
                            }}
                            onSelectOverlay={setSelOvId}
                            selectedOverlayId={selOvId}
                        />
                    </div>
                </div>

                {/* ── RIGHT: Audio ── */}
                {!hideSidebars && (
                    <div className="w-[200px] flex-shrink-0 border-l border-white/[0.04] overflow-hidden">
                        <AudioMixer />
                    </div>
                )}
            </div>
        </div>
    );
}
