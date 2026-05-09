"use client";

import { useState, useRef } from 'react';

const TRANSITIONS = [
    { id: 'cut',        label: 'Cut',           icon: '✂', desc: 'Instant switch' },
    { id: 'crossfade',  label: 'Crossfade',     icon: '⇌', desc: 'Blend together' },
    { id: 'fade_black', label: 'Fade to Black',  icon: '◼', desc: 'Through black' },
    { id: 'slide_left', label: 'Slide Left',     icon: '→', desc: 'Slide transition' },
];

function VideoDropZone({ label, file, onFile, onClear }) {
    const inputRef = useRef(null);
    const [dragging, setDragging] = useState(false);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('video/')) onFile(f);
    };

    if (file) {
        return (
            <div className="flex-1 h-10 flex items-center gap-2 px-3 rounded-xl bg-white/5 border border-[#d9ff00]/30">
                <span className="text-[#d9ff00] text-xs">▶</span>
                <span className="flex-1 text-xs text-white/80 font-medium truncate min-w-0">{file.name}</span>
                <span className="text-[10px] text-white/30 flex-shrink-0">{(file.size / 1024 / 1024).toFixed(1)}M</span>
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onClear(); }}
                    className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0 text-xs"
                >✕</button>
            </div>
        );
    }

    return (
        <div
            className={`flex-1 h-10 border border-dashed rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all text-xs ${
                dragging ? 'border-[#d9ff00] bg-[#d9ff00]/5 text-[#d9ff00]' : 'border-white/20 text-white/40 hover:border-white/40 hover:text-white/60'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
        >
            <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <span>🎬</span>
            <span className="font-medium">{label}</span>
        </div>
    );
}

export default function VideoMerger({ onMerged }) {
    const [video1, setVideo1] = useState(null);
    const [video2, setVideo2] = useState(null);
    const [transition, setTransition] = useState('crossfade');
    const [merging, setMerging] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState('');

    const canMerge = video1 && video2 && !merging;

    const handleMerge = async () => {
        if (!canMerge) return;
        setMerging(true);
        setError('');
        setProgress('Uploading...');
        try {
            const form = new FormData();
            form.append('video1', video1);
            form.append('video2', video2);
            form.append('transition', transition);
            setProgress('Processing with ffmpeg...');
            const res = await fetch('/api/merge-videos', { method: 'POST', body: form });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Server error ${res.status}`);
            }
            const blob = await res.blob();
            onMerged(URL.createObjectURL(blob));
            setProgress('');
        } catch (e) {
            setError(e.message);
            setProgress('');
        } finally {
            setMerging(false);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            {/* Video file pickers — compact single-line */}
            <div className="flex items-center gap-2">
                <VideoDropZone label="Video 1" file={video1} onFile={setVideo1} onClear={() => setVideo1(null)} />
                <span className="text-white/20 text-sm">+</span>
                <VideoDropZone label="Video 2" file={video2} onFile={setVideo2} onClear={() => setVideo2(null)} />
            </div>

            {/* Transition + Merge button on same row */}
            <div className="flex items-center gap-1.5">
                {TRANSITIONS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTransition(t.id)}
                        title={t.desc}
                        className={`flex-1 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                            transition === t.id
                                ? 'bg-[#d9ff00] text-black border-[#d9ff00]'
                                : 'border-white/10 text-white/40 hover:text-white hover:border-white/20'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {error && <p className="text-[10px] text-red-400">{error}</p>}

            <button
                onClick={handleMerge}
                disabled={!canMerge}
                className="py-1.5 rounded-lg bg-[#d9ff00] text-black text-xs font-black hover:bg-[#e5ff33] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
                {merging ? `⟳ ${progress || 'Processing...'}` : '▶ Merge & Set as Background'}
            </button>
        </div>
    );
}
