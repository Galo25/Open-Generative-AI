# Provider Router + LipSync Replicate Migration + ElevenLabs

**Date:** 2026-04-29
**Scope:** Phase 1 — LipSync studio only. Image/Video studios stay on Muapi.

---

## 1. Goals

- Replace Muapi as the LipSync backend with Replicate (more reliable, open-source models)
- Add a Settings/Admin page where API tokens for all providers are managed
- Add a global provider toggle (Muapi ↔ Replicate) that applies to LipSync
- Add ElevenLabs text-to-speech inside LipSync so users can generate audio without leaving the app
- Add a README explaining how to set up and use the repo

---

## 2. Architecture

```
packages/studio/src/
├── providers/
│   ├── muapi.js        ← LipSync generation functions extracted from muapi.js
│   ├── replicate.js    ← new Replicate client (poll-based, same shape)
│   ├── elevenlabs.js   ← ElevenLabs TTS client
│   └── router.js       ← reads active_provider from localStorage, dispatches
├── muapi.js            ← keeps workflow/agent/balance/upload functions only
├── models.js           ← lipsync models get replicateId + maxDuration fields
└── components/
    ├── LipSyncStudio.jsx   ← adds ElevenLabs panel; imports router not providers
    └── SettingsStudio.jsx  ← new admin page
```

**Dispatch flow:**
```
LipSyncStudio
  → processLipSync() [router.js]
      → active_provider === "replicate" → providers/replicate.js
      → active_provider === "muapi"     → providers/muapi.js
```

**Provider state** stored in `localStorage`:
- `active_provider` — `"muapi"` | `"replicate"` (default: `"muapi"`)
- `muapi_key` — existing key (unchanged)
- `replicate_token` — new
- `elevenlabs_key` — new

---

## 3. Settings / Admin Page (`SettingsStudio.jsx`)

New **Settings** tab in the main nav (last position). Three provider cards in a row.

### 3.1 Provider Toggle
A pill toggle at the top:
```
Active Provider:  [ Muapi ]  [ Replicate ]
```
Writing `active_provider` to localStorage. LipSync studio reads this on every generation call.

### 3.2 Provider Cards (one per provider)
Each card contains:
- Provider name + logo/icon
- Status badge: `● Connected` (green) | `○ Not configured` (grey) | `✕ Invalid key` (red)
- Masked token input with show/hide toggle
- Helper link to where the token is obtained
- **Test Connection** button — calls a lightweight provider endpoint to verify
- **Save** button — writes to localStorage

### 3.3 Studio Readiness Row
Below the cards:
```
🎙 Lip Sync    ✓ Replicate ready
🖼 Image       — Replicate (coming soon)
🎬 Video       — Replicate (coming soon)
```

### 3.4 Navigation
`StandaloneShell.js` gets a new tab entry: `{ id: 'settings', label: 'Settings' }` rendering `<SettingsStudio />`.

---

## 4. Provider Clients

### 4.1 `providers/muapi.js`
Extracts these functions verbatim from the current `muapi.js`:
- `processLipSync(apiKey, params)`

All other muapi.js functions (upload, balance, workflow, agents) stay in `muapi.js` unchanged.

### 4.2 `providers/replicate.js`
Implements:
- `processLipSync(token, params)` — maps lipsync params to Replicate input schema, submits prediction, polls `/v1/predictions/{id}`, returns `{ url }`.

**Replicate API shape:**
```
POST https://api.replicate.com/v1/predictions
Authorization: Token r8_xxx
{
  "version": "<model-version-hash>",
  "input": { ... model-specific fields ... }
}

GET https://api.replicate.com/v1/predictions/{id}
→ { status: "succeeded", output: ["https://..."] }
```

**Polling:** same pattern as current muapi.js — 2s interval, 900 max attempts, AbortController support, `onPollStatus` callback.

### 4.3 `providers/router.js`
```js
export async function processLipSync(params) {
  const provider = localStorage.getItem('active_provider') ?? 'muapi';
  if (provider === 'replicate') {
    const token = localStorage.getItem('replicate_token');
    return replicateProvider.processLipSync(token, params);
  }
  const key = localStorage.getItem('muapi_key');
  return muapiProvider.processLipSync(key, params);
}
```

`LipSyncStudio.jsx` import changes from `muapi.js` → `providers/router.js`. The `apiKey` prop is no longer passed to `processLipSync` — the router reads keys from localStorage directly.

### 4.4 `providers/elevenlabs.js`
Implements:
- `getVoices(apiKey)` — `GET /v1/voices` → returns `[{ voice_id, name }]`
- `generateSpeech(apiKey, { voiceId, text })` — `POST /v1/text-to-speech/{voice_id}` → returns audio `Blob`

---

## 5. LipSync Model Mapping

Add `replicateId` and `maxDuration` to each lipsync model in `models.js`:

### Image-mode models (portrait + audio → video)
All map to **SadTalker** on Replicate:

| Model id | replicateId | maxDuration |
|---|---|---|
| `infinitetalk-image-to-video` | `zsxkib/sadtalker` | 60s |
| `wan2.2-speech-to-video` | `zsxkib/sadtalker` | 60s |
| `ltx-2.3-lipsync` | `zsxkib/sadtalker` | 60s |
| `ltx-2-19b-lipsync` | `zsxkib/sadtalker` | 60s |

**SadTalker input mapping:**
```
image_url  → source_image (public URL)
audio_url  → driven_audio (public URL)
resolution → result_dir ignored; use still=false, preprocess=full
```

### Video-mode models (video + audio → lipsync)
All map to **Wav2Lip** on Replicate:

| Model id | replicateId | maxDuration |
|---|---|---|
| `sync-lipsync` | `devxpy/wav2lip` | 30s |
| `latent-sync` | `devxpy/wav2lip` | 30s |
| `creatify-lipsync` | `devxpy/wav2lip` | 30s |
| `veed-lipsync` | `devxpy/wav2lip` | 30s |
| `infinitetalk-video-to-video` | `devxpy/wav2lip` | 30s |

**Wav2Lip input mapping:**
```
video_url → face (public URL)
audio_url → audio (public URL)
```

---

## 6. ElevenLabs Audio Panel in LipSync Studio

### 6.1 UI
A "Generate Audio" button sits next to the audio upload button in the uploads row. Clicking it toggles an inline collapsible panel below the uploads row:

```
┌──────────────────────────────────────────────────┐
│ 🎙 Generate with ElevenLabs                      │
│                                                  │
│ Voice  [ Rachel                              ▾ ] │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ Type your script here...                     │ │
│ │                                              │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ [ Generate Audio ]          0 / 5000 chars       │
└──────────────────────────────────────────────────┘
```

### 6.2 Flow
1. Panel opens → fetch voices from ElevenLabs API, populate dropdown
2. User types script, selects voice, clicks Generate Audio
3. Call `elevenlabs.generateSpeech()` → receive audio Blob
4. Upload Blob via `muapi.uploadFile()` (or direct to Replicate as base64 URL) → get hosted URL
5. Set `audioUrl` state — same state the upload button sets
6. Panel closes, audio status shows `✓ Generated`

### 6.3 Error states
- No ElevenLabs key → show "Configure ElevenLabs in Settings" link
- API error → inline error message below the Generate button

---

## 7. README

Root-level `README.md` covering:
- What the app is
- Quick start (clone → `npm run setup` → `npm run dev`)
- How to get and configure API keys (Settings page walkthrough)
- Which models work on which provider
- How to switch providers
- Local model support (sd.cpp, Wan2GP) pointer to existing docs

---

## 8. Out of Scope (Phase 1)

- Image studio Replicate migration
- Video studio Replicate migration
- Workflow / Agent studios (keep on Muapi; can be restored from upstream)
- Replicate webhooks (polling is sufficient for now)
- Self-hosted model deployment

---

## 9. File Change Summary

| File | Action |
|---|---|
| `packages/studio/src/providers/muapi.js` | Create — extract `processLipSync` |
| `packages/studio/src/providers/replicate.js` | Create — Replicate client |
| `packages/studio/src/providers/elevenlabs.js` | Create — ElevenLabs TTS client |
| `packages/studio/src/providers/router.js` | Create — dispatch by active_provider |
| `packages/studio/src/components/SettingsStudio.jsx` | Create — admin page |
| `packages/studio/src/components/LipSyncStudio.jsx` | Edit — add ElevenLabs panel, import router |
| `packages/studio/src/models.js` | Edit — add replicateId + maxDuration to lipsync models |
| `packages/studio/src/index.js` | Edit — export SettingsStudio |
| `packages/studio/src/muapi.js` | Edit — remove processLipSync (moved to providers/) |
| `components/StandaloneShell.js` | Edit — add Settings tab |
| `README.md` | Create |
