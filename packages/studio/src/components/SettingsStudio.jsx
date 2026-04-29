"use client";

import { useState, useEffect } from "react";
import { testConnection as muapiTest } from "../providers/muapi.js";
import { testConnection as replicateTest } from "../providers/replicate.js";
import { testConnection as elTest } from "../providers/elevenlabs.js";
import { getActiveProvider, setActiveProvider } from "../providers/router.js";

const STATUS = { UNTESTED: "untested", OK: "ok", ERROR: "error", TESTING: "testing" };

function ProviderCard({ name, icon, storageKey, placeholder, helpText, helpUrl, onTest, onSave }) {
    const [value, setValue] = useState('');
    const [show, setShow] = useState(false);
    const [status, setStatus] = useState(STATUS.UNTESTED);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const stored = localStorage.getItem(storageKey) || '';
        setValue(stored);
    }, [storageKey]);

    const handleSave = () => {
        const trimmed = value.trim();
        localStorage.setItem(storageKey, trimmed);
        setStatus(STATUS.UNTESTED);
        if (onSave) onSave(trimmed);
    };

    const handleTest = async () => {
        const key = value.trim();
        if (!key) { setStatus(STATUS.ERROR); setErrorMsg('Enter a key first.'); return; }
        setStatus(STATUS.TESTING);
        setErrorMsg('');
        try {
            await onTest(key);
            setStatus(STATUS.OK);
        } catch (e) {
            setStatus(STATUS.ERROR);
            setErrorMsg(e.message);
        }
    };

    const statusBadge = {
        [STATUS.UNTESTED]: <span className="text-white/30 text-xs">○ Not tested</span>,
        [STATUS.TESTING]:  <span className="text-white/50 text-xs animate-pulse">● Testing...</span>,
        [STATUS.OK]:       <span className="text-green-400 text-xs">● Connected</span>,
        [STATUS.ERROR]:    <span className="text-red-400 text-xs">✕ Error</span>,
    }[status];

    return (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{icon}</span>
                    <span className="text-sm font-bold text-white">{name}</span>
                </div>
                {statusBadge}
            </div>
            <div>
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1 block">API Token</label>
                <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus-within:border-[#d9ff00]/40 transition-colors">
                    <input
                        type={show ? "text" : "password"}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        placeholder={placeholder}
                        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none"
                    />
                    <button type="button" onClick={() => setShow(v => !v)} className="text-white/30 hover:text-white text-xs transition-colors">
                        {show ? '🙈' : '👁'}
                    </button>
                </div>
                {helpUrl && (
                    <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#d9ff00]/50 hover:text-[#d9ff00] mt-1 block transition-colors">
                        {helpText} ↗
                    </a>
                )}
                {status === STATUS.ERROR && errorMsg && (
                    <p className="text-[10px] text-red-400 mt-1">{errorMsg}</p>
                )}
            </div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={handleTest}
                    disabled={status === STATUS.TESTING}
                    className="flex-1 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-white/60 hover:text-white hover:border-white/30 transition-all disabled:opacity-40"
                >
                    {status === STATUS.TESTING ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 py-1.5 rounded-lg bg-[#d9ff00] text-black text-xs font-bold hover:bg-[#e5ff33] transition-all"
                >
                    Save
                </button>
            </div>
        </div>
    );
}

export default function SettingsStudio() {
    const [activeProvider, setActive] = useState('muapi');

    useEffect(() => {
        setActive(getActiveProvider());
    }, []);

    const handleToggle = (provider) => {
        setActiveProvider(provider);
        setActive(provider);
    };

    return (
        <div className="w-full h-full overflow-y-auto custom-scrollbar">
            <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-8">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight">Settings</h1>
                    <p className="text-white/40 text-sm mt-1">Manage your API provider tokens and active backend.</p>
                </div>

                {/* Active Provider Toggle */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-white/40 uppercase tracking-widest">Active LipSync Provider</label>
                    <div className="flex gap-2 p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl w-fit">
                        {['muapi', 'replicate'].map(p => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => handleToggle(p)}
                                className={`px-5 py-2 rounded-lg text-sm font-bold capitalize transition-all ${
                                    activeProvider === p
                                        ? 'bg-[#d9ff00] text-black shadow-lg'
                                        : 'text-white/40 hover:text-white'
                                }`}
                            >
                                {p === 'muapi' ? 'Muapi' : 'Replicate'}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-white/30">
                        {activeProvider === 'replicate'
                            ? 'LipSync uses Replicate (SadTalker / Wav2Lip)'
                            : 'LipSync uses Muapi.ai cloud models'}
                    </p>
                </div>

                {/* Provider Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ProviderCard
                        name="Muapi.ai"
                        icon="⚡"
                        storageKey="muapi_key"
                        placeholder="mu_••••••••••••"
                        helpText="Get your key at muapi.ai"
                        helpUrl="https://muapi.ai"
                        onTest={muapiTest}
                        onSave={(key) => window.dispatchEvent(new CustomEvent('muapi-key-saved', { detail: { key } }))}
                    />
                    <ProviderCard
                        name="Replicate"
                        icon="🔁"
                        storageKey="replicate_token"
                        placeholder="r8_••••••••••••"
                        helpText="Get your token at replicate.com/account"
                        helpUrl="https://replicate.com/account/api-tokens"
                        onTest={replicateTest}
                    />
                    <ProviderCard
                        name="ElevenLabs"
                        icon="🎙"
                        storageKey="elevenlabs_key"
                        placeholder="el_••••••••••••"
                        helpText="Get your key at elevenlabs.io"
                        helpUrl="https://elevenlabs.io/app/settings/api-keys"
                        onTest={elTest}
                    />
                </div>

                {/* Studio Readiness */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-white/40 uppercase tracking-widest">Studio Provider Readiness</label>
                    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.04]">
                        {[
                            { icon: '🎙', label: 'Lip Sync', replicate: true },
                            { icon: '🖼', label: 'Image Studio', replicate: false },
                            { icon: '🎬', label: 'Video Studio', replicate: false },
                            { icon: '🎬', label: 'Cinema Studio', replicate: false },
                        ].map(({ icon, label, replicate }) => (
                            <div key={label} className="flex items-center justify-between px-4 py-3">
                                <span className="text-sm text-white/60">{icon} {label}</span>
                                {replicate
                                    ? <span className="text-xs text-green-400 font-bold">✓ Replicate ready</span>
                                    : <span className="text-xs text-white/20">— Replicate coming soon</span>
                                }
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
