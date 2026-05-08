import { NextResponse } from 'next/server';

// Proxies /api/v2v/* -> {x-v2v-backend}/* (default http://localhost:8000)
// Handles both JSON and multipart/form-data uploads transparently.
async function proxy(request, context, method) {
    const slug = await context.params;
    const path = (slug.path || []).join('/');
    const { search } = new URL(request.url);
    const backendUrl = (request.headers.get('x-v2v-backend') || 'http://localhost:8000').replace(/\/$/, '');
    const targetUrl = `${backendUrl}/${path}${search}`;

    const headers = new Headers();
    const ct = request.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    // Forward API key headers so the backend can use browser-stored tokens
    for (const h of ['x-elevenlabs-key', 'x-anthropic-key', 'x-openai-key', 'x-google-key', 'x-replicate-key']) {
        const v = request.headers.get(h);
        if (v) headers.set(h, v);
    }

    try {
        const opts = { method, headers };
        if (method !== 'GET' && method !== 'HEAD') {
            const buf = await request.arrayBuffer();
            if (buf.byteLength) opts.body = buf;
        }
        const response = await fetch(targetUrl, opts);
        const resCt = response.headers.get('content-type') || '';
        if (resCt.includes('application/json')) {
            const data = await response.json();
            return NextResponse.json(data, { status: response.status });
        }
        const buffer = await response.arrayBuffer();
        return new NextResponse(buffer, {
            status: response.status,
            headers: { 'content-type': resCt },
        });
    } catch (error) {
        return NextResponse.json({ error: error.message, backend: backendUrl }, { status: 502 });
    }
}

export async function GET(request, context)    { return proxy(request, context, 'GET'); }
export async function POST(request, context)   { return proxy(request, context, 'POST'); }
export async function PUT(request, context)    { return proxy(request, context, 'PUT'); }
export async function DELETE(request, context) { return proxy(request, context, 'DELETE'); }
