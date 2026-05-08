"use client";

import { useEffect, useRef } from 'react';

// ── VideoClip ────────────────────────────────────────────────────────────────

function VideoClip({ clip, isVisible, sx, sy }) {
    const ref = useRef(null);
    useEffect(() => {
        const v = ref.current;
        if (!v) return;
        if (isVisible) { v.currentTime = 0; v.play().catch(() => {}); }
        else           { v.pause(); v.currentTime = 0; }
    }, [isVisible]);

    return (
        <video
            ref={ref}
            src={clip.url}
            muted
            playsInline
            loop={clip.loop !== false}
            style={{
                position:  'absolute',
                left:      clip.x * sx + 'px',
                top:       clip.y * sy + 'px',
                width:     clip.w * sx + 'px',
                height:    clip.h * sy + 'px',
                opacity:   clip.opacity ?? 1,
                zIndex:    15,
                pointerEvents: 'none',
                objectFit: 'contain',
                display:   isVisible ? 'block' : 'none',
                borderRadius: clip.rounded ? '8px' : '0',
            }}
        />
    );
}

// ── GifClip ──────────────────────────────────────────────────────────────────

function GifClip({ clip, isVisible, sx, sy }) {
    return isVisible ? (
        <img
            src={clip.url}
            alt={clip.label}
            style={{
                position:  'absolute',
                left:      clip.x * sx + 'px',
                top:       clip.y * sy + 'px',
                width:     clip.w * sx + 'px',
                height:    clip.h * sy + 'px',
                opacity:   clip.opacity ?? 1,
                zIndex:    15,
                pointerEvents: 'none',
                objectFit: 'contain',
                borderRadius: clip.rounded ? '8px' : '0',
            }}
        />
    ) : null;
}

// ── LottieClip ───────────────────────────────────────────────────────────────

function LottieClip({ clip, isVisible, sx, sy }) {
    const containerRef = useRef(null);
    const animRef      = useRef(null);

    useEffect(() => {
        if (!containerRef.current) return;
        let cancelled = false;

        const init = async (src) => {
            const { default: lottie } = await import('lottie-web');
            if (cancelled || !containerRef.current) return;
            let animData;
            try {
                if (typeof src === 'string') {
                    const res = await fetch(src);
                    animData = await res.json();
                } else {
                    animData = src;
                }
            } catch { return; }
            if (cancelled || !containerRef.current) return;
            animRef.current?.destroy();
            animRef.current = lottie.loadAnimation({
                container:     containerRef.current,
                renderer:      'svg',
                loop:          clip.loop !== false,
                autoplay:      false,
                animationData: animData,
            });
        };

        init(clip.url);
        return () => {
            cancelled = true;
            animRef.current?.destroy();
            animRef.current = null;
        };
    }, [clip.url, clip.loop]);

    useEffect(() => {
        const anim = animRef.current;
        if (!anim) return;
        if (isVisible) { anim.goToAndPlay(0, true); }
        else           { anim.pause(); anim.goToAndStop(0, true); }
    }, [isVisible]);

    return (
        <div
            ref={containerRef}
            style={{
                position:  'absolute',
                left:      clip.x * sx + 'px',
                top:       clip.y * sy + 'px',
                width:     clip.w * sx + 'px',
                height:    clip.h * sy + 'px',
                opacity:   clip.opacity ?? 1,
                zIndex:    15,
                pointerEvents: 'none',
                display:   isVisible ? 'block' : 'none',
            }}
        />
    );
}

// ── ClipOverlaysLayer ─────────────────────────────────────────────────────────

export default function ClipOverlaysLayer({ clips, currentTime, scaleX = 1, scaleY = 1 }) {
    if (!clips || clips.length === 0) return null;
    return clips.map(clip => {
        const isVisible = currentTime >= clip.startTime && currentTime <= clip.endTime;
        if (clip.type === 'lottie') return <LottieClip key={clip.id} clip={clip} isVisible={isVisible} sx={scaleX} sy={scaleY} />;
        if (clip.type === 'gif')    return <GifClip    key={clip.id} clip={clip} isVisible={isVisible} sx={scaleX} sy={scaleY} />;
        return                             <VideoClip  key={clip.id} clip={clip} isVisible={isVisible} sx={scaleX} sy={scaleY} />;
    });
}
