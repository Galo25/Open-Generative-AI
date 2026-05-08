/**
 * LipSync job history — localStorage only, no blob URLs.
 *
 * Works identically on localhost and any cloud deployment because it writes
 * only to the browser's own storage. Output URLs come from the upstream API
 * (muapi / Replicate) and are always absolute remote URLs that outlive the
 * browser session.
 */

const LS_KEY  = 'lipsync_jobs_v1';
const MAX_JOBS = 50;

// ── helpers ────────────────────────────────────────────────────────────────

function load() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function save(jobs) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(jobs.slice(0, MAX_JOBS)));
    } catch { /* storage full — silently skip */ }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Return all stored jobs, newest first. */
export function loadJobs() {
    return load();
}

/**
 * Add a new job with status 'running'.
 * Returns the job object so the caller can track its id.
 */
export function startJob({ model, inputType, inputThumbnail, audioName, prompt, resolution }) {
    const job = {
        id:             `ls_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        status:         'running',   // 'running' | 'done' | 'failed'
        model,                       // { id, name }
        inputType,                   // 'image' | 'video'
        inputThumbnail: inputThumbnail || null,  // remote URL safe to store
        audioName:      audioName    || '',
        prompt:         prompt       || null,
        resolution:     resolution   || null,
        outputUrl:      null,
        error:          null,
        startedAt:      new Date().toISOString(),
        completedAt:    null,
        durationMs:     null,
    };
    const jobs = [job, ...load()];
    save(jobs);
    return job;
}

/** Mark a job done with its output URL. */
export function completeJob(id, outputUrl) {
    const jobs = load().map(j => {
        if (j.id !== id) return j;
        return {
            ...j,
            status:      'done',
            outputUrl,
            completedAt: new Date().toISOString(),
            durationMs:  j.startedAt ? Date.now() - new Date(j.startedAt).getTime() : null,
        };
    });
    save(jobs);
    return jobs;
}

/** Mark a job failed with an error message. */
export function failJob(id, error) {
    const jobs = load().map(j => {
        if (j.id !== id) return j;
        return {
            ...j,
            status:      'failed',
            error:       error || 'Unknown error',
            completedAt: new Date().toISOString(),
            durationMs:  j.startedAt ? Date.now() - new Date(j.startedAt).getTime() : null,
        };
    });
    save(jobs);
    return jobs;
}

/** Move a job to a folder (or remove from folder if folderId is null). */
export function assignJobToFolder(jobId, folderId) {
    const jobs = load().map(j => j.id === jobId ? { ...j, folderId: folderId ?? null } : j);
    save(jobs);
    return jobs;
}

/** Remove a single job. */
export function removeJob(id) {
    const jobs = load().filter(j => j.id !== id);
    save(jobs);
    return jobs;
}

/** Wipe all jobs. */
export function clearAllJobs() {
    try { localStorage.removeItem(LS_KEY); } catch { /* */ }
    return [];
}

/** Format a duration in ms as "1m 23s" or "45s". */
export function fmtDuration(ms) {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Format an ISO timestamp as a short relative label. */
export function fmtRelative(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}
