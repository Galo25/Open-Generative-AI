/**
 * CanvEditor session persistence — localStorage (metadata) + IndexedDB (blobs).
 *
 * A single "current" session is auto-saved; older blobs are replaced in-place.
 */

const LS_KEY  = 'canv_editor_session_v1';
const DB_NAME = 'canv_editor_blobs';
const STORE   = 'blobs';

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

let _db = null;
async function getDB() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
        req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
        req.onerror    = e => reject(e.target.error);
    });
}

async function idbSet(key, blob) {
    const db = await getDB();
    if (!db || !blob) return;
    const buf = await blob.arrayBuffer();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ buf, type: blob.type || 'application/octet-stream' }, key);
        tx.oncomplete = () => res();
        tx.onerror    = e => rej(e.target.error);
    });
}

async function idbGet(key) {
    const db = await getDB();
    if (!db) return null;
    return new Promise((res, rej) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = e => {
            const entry = e.target.result;
            res(entry ? new Blob([entry.buf], { type: entry.type }) : null);
        };
        req.onerror = e => rej(e.target.error);
    });
}

async function idbDel(key) {
    const db = await getDB();
    if (!db) return;
    return new Promise(res => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => res();
        tx.onerror    = () => res();
    });
}

async function idbClear() {
    const db = await getDB();
    if (!db) return;
    return new Promise(res => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => res();
        tx.onerror    = () => res();
    });
}

// ── Blob helpers ──────────────────────────────────────────────────────────────

async function blobFromUrl(url) {
    if (!url) return null;
    try { return await fetch(url).then(r => r.blob()); }
    catch { return null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save the current canvas state. Blobs are stored in IndexedDB only when the
 * source URL has actually changed (tracked by lastSavedUrls map).
 */
export async function saveCanvSession(state, canvasRef, lastSavedUrls) {
    const { bgType, bgColor, bgVideoUrl, bgImageUrl, captions, clips } = state;

    const meta = {
        bgType, bgColor,
        hasBgVideo: false,
        hasBgImage: false,
        captions,           // fully serialisable (includes words array)
        clips:     [],      // clip metadata; blobs go to IDB
        fabricSnap: null,
        savedAt:   Date.now(),
    };

    // Background video
    if (bgVideoUrl) {
        if (bgVideoUrl !== lastSavedUrls.bgVideo) {
            const blob = await blobFromUrl(bgVideoUrl);
            if (blob) { await idbSet('bg_video', blob); lastSavedUrls.bgVideo = bgVideoUrl; }
        }
        meta.hasBgVideo = true;
    } else {
        await idbDel('bg_video');
        lastSavedUrls.bgVideo = null;
    }

    // Background image
    if (bgImageUrl) {
        if (bgImageUrl !== lastSavedUrls.bgImage) {
            const blob = await blobFromUrl(bgImageUrl);
            if (blob) { await idbSet('bg_image', blob); lastSavedUrls.bgImage = bgImageUrl; }
        }
        meta.hasBgImage = true;
    } else {
        await idbDel('bg_image');
        lastSavedUrls.bgImage = null;
    }

    // Clip blobs
    const savedClipIds = new Set();
    for (const clip of clips) {
        const clipMeta = { ...clip, hasBlob: false, url: null };
        if (clip.url && clip.url.startsWith('blob:')) {
            if (clip.url !== lastSavedUrls[clip.id]) {
                const blob = await blobFromUrl(clip.url);
                if (blob) { await idbSet(`clip_${clip.id}`, blob); lastSavedUrls[clip.id] = clip.url; }
            }
            clipMeta.hasBlob = true;
        } else if (clip.url) {
            // Lottie or remote URL — store as-is
            clipMeta.url = clip.url;
        }
        meta.clips.push(clipMeta);
        savedClipIds.add(clip.id);
    }
    // Remove stale clip blobs
    for (const key of Object.keys(lastSavedUrls)) {
        if (key.startsWith('clip_') && !savedClipIds.has(key.replace('clip_', ''))) {
            await idbDel(key);
            delete lastSavedUrls[key];
        }
    }

    // Fabric.js canvas snapshot (shapes + text, excluding blob-URL images)
    try {
        const snap = canvasRef?.current?.getJSON?.();
        if (snap) meta.fabricSnap = snap;
    } catch { /* non-critical */ }

    localStorage.setItem(LS_KEY, JSON.stringify(meta));
}

/**
 * Load session from storage. Returns null if no session found.
 */
export async function loadCanvSession() {
    let raw;
    try { raw = localStorage.getItem(LS_KEY); }
    catch { return null; }
    if (!raw) return null;

    let meta;
    try { meta = JSON.parse(raw); }
    catch { return null; }

    const result = {
        bgType:     meta.bgType    || 'color',
        bgColor:    meta.bgColor   || '#000000',
        bgVideoUrl: null,
        bgImageUrl: null,
        captions:   meta.captions  || [],
        clips:      [],
        fabricSnap: meta.fabricSnap || null,
        savedAt:    meta.savedAt   || null,
    };

    if (meta.hasBgVideo) {
        try {
            const blob = await idbGet('bg_video');
            if (blob) result.bgVideoUrl = URL.createObjectURL(blob);
        } catch { /* skip */ }
    }

    if (meta.hasBgImage) {
        try {
            const blob = await idbGet('bg_image');
            if (blob) result.bgImageUrl = URL.createObjectURL(blob);
        } catch { /* skip */ }
    }

    for (const clip of (meta.clips || [])) {
        const restored = { ...clip };
        if (clip.hasBlob) {
            try {
                const blob = await idbGet(`clip_${clip.id}`);
                restored.url = blob ? URL.createObjectURL(blob) : null;
            } catch { restored.url = null; }
        }
        if (restored.url !== null) result.clips.push(restored);
    }

    return result;
}

export async function clearCanvSession() {
    try { localStorage.removeItem(LS_KEY); } catch { /* */ }
    await idbClear().catch(() => {});
}
