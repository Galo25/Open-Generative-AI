"use client";

import { useRef, useCallback, useState } from 'react';

const COLORS = ['#d9ff00', '#00d4ff', '#ff6b35', '#a855f7', '#22c55e', '#f59e0b', '#ec4899'];

function colorForIdx(i) { return COLORS[i % COLORS.length]; }

function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
}

// A draggable handle for start/end of an overlay strip
function ResizeHandle({ onDrag, side }) {
    const start = useRef(null);

    const handleMouseDown = (e) => {
        e.stopPropagation();
        start.current = { x: e.clientX };
        const move = (me) => onDrag(me.clientX - start.current.x, side);
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            className={`absolute top-0 bottom-0 w-2 cursor-ew-resize z-10 flex items-center justify-center ${side === 'left' ? 'left-0' : 'right-0'}`}
        >
            <div className="w-1 h-4 rounded-full bg-white/60" />
        </div>
    );
}

export default function Timeline({ overlays, duration, currentTime, onSeek, onUpdateTiming, onSelectOverlay, selectedOverlayId }) {
    const railRef = useRef(null);
    const [draggingId, setDraggingId] = useState(null);

    const effectiveDuration = duration || 30;

    // Click on rail to seek
    const handleRailClick = useCallback((e) => {
        if (!railRef.current) return;
        const rect = railRef.current.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        onSeek?.(ratio * effectiveDuration);
    }, [effectiveDuration, onSeek]);

    const handleStripDrag = useCallback((overlay, deltaX, side) => {
        if (!railRef.current) return;
        const railW = railRef.current.getBoundingClientRect().width;
        const deltaSec = (deltaX / railW) * effectiveDuration;
        let { startTime, endTime } = overlay;

        if (side === 'left') {
            startTime = Math.max(0, Math.min(endTime - 0.5, startTime + deltaSec));
        } else if (side === 'right') {
            endTime = Math.max(startTime + 0.5, Math.min(effectiveDuration, endTime + deltaSec));
        } else {
            // Move entire strip
            const dur = endTime - startTime;
            startTime = Math.max(0, Math.min(effectiveDuration - dur, startTime + deltaSec));
            endTime = startTime + dur;
        }
        onUpdateTiming?.(overlay.id, startTime, endTime);
    }, [effectiveDuration, onUpdateTiming]);

    const handleStripMouseDown = useCallback((e, overlay) => {
        e.stopPropagation();
        onSelectOverlay?.(overlay.id);
        const startX = e.clientX;
        let moved = false;
        const startStart = overlay.startTime;
        const startEnd = overlay.endTime;

        const move = (me) => {
            moved = true;
            const deltaX = me.clientX - startX;
            if (!railRef.current) return;
            const railW = railRef.current.getBoundingClientRect().width;
            const deltaSec = (deltaX / railW) * effectiveDuration;
            const dur = startEnd - startStart;
            const newStart = Math.max(0, Math.min(effectiveDuration - dur, startStart + deltaSec));
            onUpdateTiming?.(overlay.id, newStart, newStart + dur);
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            setDraggingId(null);
        };
        setDraggingId(overlay.id);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }, [effectiveDuration, onUpdateTiming, onSelectOverlay]);

    const tickCount = Math.min(12, Math.ceil(effectiveDuration));
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (i / tickCount) * effectiveDuration);

    return (
        <div className="flex flex-col gap-1.5 select-none">
            {/* Tick ruler */}
            <div className="flex items-end h-5 px-0 relative" ref={railRef} onClick={handleRailClick}>
                <div className="absolute inset-0 bg-white/[0.02] rounded-t-lg" />
                {ticks.map((t, i) => (
                    <div key={i} className="absolute flex flex-col items-center" style={{ left: `${(t / effectiveDuration) * 100}%` }}>
                        <span className="text-[9px] text-white/30 leading-none">{fmt(t)}</span>
                        <div className="w-px h-2 bg-white/10 mt-0.5" />
                    </div>
                ))}
                {/* Playhead */}
                <div
                    className="absolute top-0 bottom-0 w-0.5 bg-[#d9ff00] z-20 pointer-events-none"
                    style={{ left: `${(currentTime / effectiveDuration) * 100}%`, transition: 'left 0.1s linear' }}
                >
                    <div className="absolute -top-0.5 -left-1 w-2 h-2 bg-[#d9ff00] rotate-45" />
                </div>
            </div>

            {/* Overlay strips */}
            <div className="flex flex-col gap-1">
                {overlays.length === 0 && (
                    <div className="h-8 flex items-center justify-center text-[11px] text-white/20">
                        No overlays yet — add text, shapes or images above
                    </div>
                )}
                {overlays.map((ov, idx) => {
                    const leftPct = (ov.startTime / effectiveDuration) * 100;
                    const widthPct = ((ov.endTime - ov.startTime) / effectiveDuration) * 100;
                    const color = colorForIdx(idx);
                    const isSelected = selectedOverlayId === ov.id;

                    return (
                        <div key={ov.id} className="relative h-7 bg-white/[0.02] rounded-lg overflow-hidden"
                            ref={(el) => { if (el && !el._railListener) { el._railListener = true; } }}>
                            <div
                                className={`absolute top-0.5 bottom-0.5 rounded-md flex items-center cursor-grab active:cursor-grabbing transition-opacity ${draggingId === ov.id ? 'opacity-80' : ''}`}
                                style={{
                                    left: `${leftPct}%`,
                                    width: `${widthPct}%`,
                                    background: `${color}30`,
                                    border: `1.5px solid ${isSelected ? color : color + '80'}`,
                                    boxShadow: isSelected ? `0 0 6px ${color}60` : 'none',
                                }}
                                onMouseDown={(e) => handleStripMouseDown(e, ov)}
                            >
                                <ResizeHandle onDrag={(dx) => handleStripDrag(ov, dx, 'left')} side="left" />
                                <span className="flex-1 text-[10px] font-bold px-3 truncate" style={{ color }}>
                                    {ov.label}
                                </span>
                                <ResizeHandle onDrag={(dx) => handleStripDrag(ov, dx, 'right')} side="right" />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
