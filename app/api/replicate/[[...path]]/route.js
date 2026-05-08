import { NextResponse } from 'next/server';

const REPLICATE_BASE = 'https://api.replicate.com';

function cleanHeaders(request) {
    const headers = new Headers();
    const auth = request.headers.get('authorization');
    if (auth) headers.set('authorization', auth);
    const prefer = request.headers.get('prefer');
    if (prefer) headers.set('prefer', prefer);
    headers.set('content-type', 'application/json');
    return headers;
}

// Proxies /api/replicate/* -> https://api.replicate.com/*
export async function GET(request, { params }) {
    const slug = await params;
    const path = (slug.path || []).join('/');
    const { search } = new URL(request.url);
    const targetUrl = `${REPLICATE_BASE}/${path}${search}`;

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: cleanHeaders(request),
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const slug = await params;
    const path = (slug.path || []).join('/');
    const { search } = new URL(request.url);
    const targetUrl = `${REPLICATE_BASE}/${path}${search}`;

    try {
        const body = await request.text();
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: cleanHeaders(request),
            body,
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
