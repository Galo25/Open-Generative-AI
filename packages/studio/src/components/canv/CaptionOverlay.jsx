"use client";

const FONT_SIZES = { sm: 18, md: 26, lg: 36 };

function WordHighlight({ words, currentTime, highlightColor, highlightStyle }) {
    if (!words || words.length === 0) return null;
    const hl = highlightStyle || 'color';
    const hlc = highlightColor || '#d9ff00';

    return words.map((w, i) => {
        const active = currentTime >= w.start && currentTime <= w.end;
        return (
            <span key={i} style={{
                color:          hl === 'color'     && active ? hlc         : 'inherit',
                background:     hl === 'box'       && active ? hlc         : 'transparent',
                textDecoration: hl === 'underline' && active ? `underline 3px ${hlc}` : 'none',
                fontWeight:     hl === 'bold'      && active ? '900'       : 'inherit',
                borderRadius:   hl === 'box' ? '2px' : 0,
                padding:        hl === 'box' && active ? '0 3px' : 0,
                transition:     'color 0.08s, background 0.08s',
            }}>
                {w.word}
            </span>
        );
    });
}

export default function CaptionOverlay({ captions, currentTime, selectedId, onMove }) {
    if (!captions || captions.length === 0) return null;

    const handleMouseDown = (cap, e) => {
        if (!onMove) return;
        e.preventDefault();
        e.stopPropagation();
        const sx = e.clientX, sy = e.clientY;
        const cx0 = cap.x ?? 50, cy0 = cap.y ?? 90;
        const canvasEl = e.currentTarget.closest('[data-caption-canvas]');
        const rect = canvasEl?.getBoundingClientRect();
        if (!rect) return;

        const onMm = (me) => {
            onMove(
                cap.id,
                Math.max(2, Math.min(98, cx0 + ((me.clientX - sx) / rect.width)  * 100)),
                Math.max(2, Math.min(98, cy0 + ((me.clientY - sy) / rect.height) * 100)),
            );
        };
        const onMu = () => {
            window.removeEventListener('mousemove', onMm);
            window.removeEventListener('mouseup', onMu);
        };
        window.addEventListener('mousemove', onMm);
        window.addEventListener('mouseup', onMu);
    };

    return captions.map(cap => {
        const isActive   = currentTime >= cap.start && currentTime <= cap.end;
        const isSelected = cap.id === selectedId;
        if (!isActive && !isSelected) return null;

        const x  = cap.x ?? 50;
        const y  = cap.y ?? 90;
        const fz = FONT_SIZES[cap.size] || 26;
        const showWords = cap.highlight && cap.words && cap.words.length > 0;

        return (
            <div
                key={cap.id}
                onMouseDown={onMove ? (e) => handleMouseDown(cap, e) : undefined}
                style={{
                    position:      'absolute',
                    left:          `${x}%`,
                    top:           `${y}%`,
                    transform:     'translate(-50%, -50%)',
                    zIndex:        20,
                    pointerEvents: onMove ? 'auto' : 'none',
                    cursor:        onMove ? 'grab' : 'default',
                    userSelect:    'none',
                    textAlign:     'center',
                    maxWidth:      '88%',
                    padding:       '4px 14px 5px',
                    borderRadius:  '5px',
                    background:    isActive ? (cap.bg ?? 'rgba(0,0,0,0.72)') : 'rgba(0,0,0,0.15)',
                    color:         cap.color ?? '#ffffff',
                    fontSize:      fz + 'px',
                    fontFamily:    "'Arial', 'Helvetica Neue', sans-serif",
                    fontWeight:    'bold',
                    lineHeight:    '1.35',
                    whiteSpace:    'pre-line',
                    letterSpacing: '0.01em',
                    textShadow:    (!cap.bg || cap.bg === 'transparent')
                        ? '0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.7)'
                        : 'none',
                    opacity:       isActive ? 1 : 0.45,
                    outline:       isSelected ? '2px dashed rgba(217,255,0,0.8)' : 'none',
                    outlineOffset: '4px',
                }}
            >
                {showWords ? (
                    <WordHighlight
                        words={cap.words}
                        currentTime={currentTime}
                        highlightColor={cap.highlightColor}
                        highlightStyle={cap.highlightStyle}
                    />
                ) : cap.text}
            </div>
        );
    });
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

function _parseTime(str) {
    const s = str.trim().replace(',', '.');
    const [timePart, msPart = '0'] = s.split('.');
    const parts = timePart.split(':').map(Number);
    let secs = 0;
    if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else secs = parts[0];
    return secs + parseInt(msPart.slice(0, 3).padEnd(3, '0'), 10) / 1000;
}

function _stripTags(str) {
    return str.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
}

export function parseSRT(text) {
    const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
    const cues = [];
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        const tcIdx = lines.findIndex(l => l.includes('-->'));
        if (tcIdx < 0) continue;
        const [startStr, endStr] = lines[tcIdx].split('-->');
        const caption = lines.slice(tcIdx + 1).map(_stripTags).filter(Boolean).join('\n');
        if (!caption) continue;
        cues.push({ start: _parseTime(startStr), end: _parseTime(endStr), text: caption });
    }
    return cues;
}

export function parseVTT(text) {
    return parseSRT(text.replace(/^WEBVTT[^\n]*\n/, ''));
}

export function parseASS(text) {
    const cues = [];
    const dialogueRe = /^Dialogue:[^,]*,([^,]+),([^,]+),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)/;
    for (const line of text.split('\n')) {
        const m = dialogueRe.exec(line);
        if (!m) continue;
        const caption = _stripTags(m[3]).replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();
        if (!caption) continue;
        cues.push({ start: _parseTime(m[1]), end: _parseTime(m[2]), text: caption });
    }
    return cues;
}

export function parseCaptionFile(text, filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (ext === 'ass' || ext === 'ssa') return parseASS(text);
    if (ext === 'vtt') return parseVTT(text);
    return parseSRT(text);
}
