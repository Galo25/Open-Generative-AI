import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

export const runtime = 'nodejs';

const execAsync = promisify(exec);

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
// Augment PATH so conda/homebrew ffmpeg is found even in non-interactive shells
const EXEC_ENV = {
    ...process.env,
    PATH: [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/Users/galinbar/miniconda3/bin',
        process.env.PATH || '',
    ].join(':'),
};

const XFADE_MAP = {
    crossfade:  { transition: 'fade',      duration: 1.0 },
    fade_black: { transition: 'fadeblack', duration: 1.0 },
    slide_left: { transition: 'slideleft', duration: 0.8 },
};

async function getVideoDuration(filePath) {
    const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { env: EXEC_ENV }
    );
    return parseFloat(stdout.trim());
}

async function writeTempFile(buffer, ext) {
    const path = join(tmpdir(), `canveditor_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    await writeFile(path, buffer);
    return path;
}

export async function POST(request) {
    const tmpFiles = [];
    try {
        const formData = await request.formData();
        const video1File = formData.get('video1');
        const video2File = formData.get('video2');
        const transition = formData.get('transition') || 'cut';

        if (!video1File || !video2File) {
            return NextResponse.json({ error: 'Two video files required' }, { status: 400 });
        }

        const buf1 = Buffer.from(await video1File.arrayBuffer());
        const buf2 = Buffer.from(await video2File.arrayBuffer());

        const ext1 = (video1File.name || 'video1.mp4').split('.').pop();
        const ext2 = (video2File.name || 'video2.mp4').split('.').pop();

        const in1 = await writeTempFile(buf1, ext1);
        const in2 = await writeTempFile(buf2, ext2);
        const outPath = join(tmpdir(), `canveditor_out_${Date.now()}.mp4`);
        tmpFiles.push(in1, in2, outPath);

        let cmd;
        if (transition === 'cut') {
            // Simple concat — no audio track (video-only merge for simplicity)
            cmd = `${FFMPEG} -y -i "${in1}" -i "${in2}" -filter_complex "[0:v][1:v]concat=n=2:v=1[outv]" -map "[outv]" -c:v libx264 -preset fast -crf 23 "${outPath}"`;
        } else {
            const xfade = XFADE_MAP[transition];
            if (!xfade) return NextResponse.json({ error: `Unknown transition: ${transition}` }, { status: 400 });
            const dur1 = await getVideoDuration(in1);
            const offset = Math.max(0, dur1 - xfade.duration);
            cmd = `${FFMPEG} -y -i "${in1}" -i "${in2}" -filter_complex "[0:v][1:v]xfade=transition=${xfade.transition}:duration=${xfade.duration}:offset=${offset}[outv]" -map "[outv]" -c:v libx264 -preset fast -crf 23 "${outPath}"`;
        }

        await execAsync(cmd, { env: EXEC_ENV, maxBuffer: 50 * 1024 * 1024 });

        const outBuf = await readFile(outPath);
        return new NextResponse(outBuf, {
            status: 200,
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Disposition': 'inline; filename="merged.mp4"',
            },
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Merge failed' }, { status: 500 });
    } finally {
        for (const f of tmpFiles) {
            unlink(f).catch(() => {});
        }
    }
}
