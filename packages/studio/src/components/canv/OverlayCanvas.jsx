"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';

let fabricLib = null;
let fabricLoadPromise = null;

function loadFabric() {
    if (fabricLib) return Promise.resolve(fabricLib);
    if (!fabricLoadPromise) {
        fabricLoadPromise = import('fabric').then(mod => {
            fabricLib = mod.fabric || mod.default?.fabric || mod.default || mod;
            return fabricLib;
        });
    }
    return fabricLoadPromise;
}

let _idCounter = 1;
function uid() { return `ov_${_idCounter++}`; }

// The wrapper div is what gets positioned absolutely — fabric wraps the inner canvas
// in a .canvas-container div, but that lives INSIDE our positioned wrapper.
const OverlayCanvas = forwardRef(function OverlayCanvas(
    { width, height, onOverlaysChange, currentTime, bgColor },
    ref
) {
    const wrapperRef  = useRef(null);
    const canvasEl    = useRef(null);
    const fabricRef   = useRef(null);
    const overlaysRef = useRef([]);
    const readyRef    = useRef(false);

    const notify = useCallback(() => {
        if (onOverlaysChange) onOverlaysChange([...overlaysRef.current]);
    }, [onOverlaysChange]);

    // Init fabric once
    useEffect(() => {
        let fc;
        loadFabric().then(fabric => {
            if (!canvasEl.current || fabricRef.current) return;
            fc = new fabric.Canvas(canvasEl.current, {
                selection: true,
                width:  width  || 640,
                height: height || 360,
                backgroundColor: bgColor || null,
            });
            fabricRef.current = fc;
            readyRef.current = true;
            fc.on('object:removed',  notify);
            fc.on('object:modified', notify);
        });
        return () => {
            readyRef.current = false;
            if (fabricRef.current) {
                try { fabricRef.current.dispose(); } catch {}
                fabricRef.current = null;
            }
            fabricLoadPromise = null;
            fabricLib = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Resize when dimensions change
    useEffect(() => {
        const fc = fabricRef.current;
        if (!fc) return;
        fc.setWidth(width   || 640);
        fc.setHeight(height || 360);
        fc.renderAll();
    }, [width, height]);

    // Background color
    useEffect(() => {
        const fc = fabricRef.current;
        if (!fc) return;
        fc.setBackgroundColor(bgColor || '', () => fc.renderAll());
    }, [bgColor]);

    // Show/hide overlays based on video currentTime
    useEffect(() => {
        const fc = fabricRef.current;
        if (!fc) return;
        overlaysRef.current.forEach(({ fabricObj, startTime, endTime }) => {
            const visible = currentTime >= startTime && currentTime <= endTime;
            if (fabricObj.visible !== visible) {
                fabricObj.set('visible', visible);
            }
        });
        fc.renderAll();
    }, [currentTime]);

    // ── Public API ────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
        async addText(text = 'Double-click to edit') {
            const fabric = await loadFabric();
            const fc = fabricRef.current;
            if (!fc) return;
            const obj = new fabric.IText(text, {
                left: 60, top: 60,
                fontSize: 36,
                fill: '#ffffff',
                fontFamily: 'Arial',
                fontWeight: 'bold',
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.8)', blur: 6, offsetX: 2, offsetY: 2 }),
            });
            obj._oid = uid();
            fc.add(obj);
            fc.setActiveObject(obj);
            fc.renderAll();
            const e = { id: obj._oid, label: text.slice(0, 20), fabricObj: obj, startTime: 0, endTime: 9999 };
            overlaysRef.current = [...overlaysRef.current, e];
            notify();
        },

        async addLabel(text = 'Label') {
            const fabric = await loadFabric();
            const fc = fabricRef.current;
            if (!fc) return;
            const bg = new fabric.Rect({ width: 180, height: 38, fill: 'rgba(0,0,0,0.72)', rx: 8, ry: 8 });
            const txt = new fabric.Text(text, { fontSize: 17, fill: '#ffffff', fontFamily: 'Arial', fontWeight: 'bold', left: 10, top: 10 });
            const grp = new fabric.Group([bg, txt], { left: 60, top: 80 });
            grp._oid = uid();
            fc.add(grp);
            fc.setActiveObject(grp);
            fc.renderAll();
            const e = { id: grp._oid, label: text, fabricObj: grp, startTime: 0, endTime: 9999 };
            overlaysRef.current = [...overlaysRef.current, e];
            notify();
        },

        async addRect() {
            const fabric = await loadFabric();
            const fc = fabricRef.current;
            if (!fc) return;
            const obj = new fabric.Rect({
                left: 80, top: 80, width: 160, height: 100,
                fill: 'rgba(217,255,0,0.25)', stroke: '#d9ff00', strokeWidth: 2,
                rx: 6, ry: 6,
            });
            obj._oid = uid();
            fc.add(obj);
            fc.setActiveObject(obj);
            fc.renderAll();
            const e = { id: obj._oid, label: 'Rectangle', fabricObj: obj, startTime: 0, endTime: 9999 };
            overlaysRef.current = [...overlaysRef.current, e];
            notify();
        },

        async addCircle() {
            const fabric = await loadFabric();
            const fc = fabricRef.current;
            if (!fc) return;
            const obj = new fabric.Circle({
                left: 80, top: 80, radius: 60,
                fill: 'rgba(217,255,0,0.25)', stroke: '#d9ff00', strokeWidth: 2,
            });
            obj._oid = uid();
            fc.add(obj);
            fc.setActiveObject(obj);
            fc.renderAll();
            const e = { id: obj._oid, label: 'Circle', fabricObj: obj, startTime: 0, endTime: 9999 };
            overlaysRef.current = [...overlaysRef.current, e];
            notify();
        },

        async addImage(file) {
            const fabric = await loadFabric();
            const fc = fabricRef.current;
            if (!fc) return;
            const url = URL.createObjectURL(file);
            fabric.Image.fromURL(url, img => {
                const maxW = (fc.width || 640) * 0.45;
                if (img.width > maxW) img.scaleToWidth(maxW);
                img.set({ left: 80, top: 80 });
                img._oid = uid();
                fc.add(img);
                fc.setActiveObject(img);
                fc.renderAll();
                const e = { id: img._oid, label: file.name.slice(0, 20), fabricObj: img, startTime: 0, endTime: 9999 };
                overlaysRef.current = [...overlaysRef.current, e];
                notify();
            }, { crossOrigin: 'anonymous' });
        },

        async setBackgroundImage(url) {
            const fabric = await loadFabric();
            const fc = fabricRef.current;
            if (!fc) return;
            if (!url) { fc.setBackgroundImage(null, () => fc.renderAll()); return; }
            fabric.Image.fromURL(url, img => {
                img.scaleToWidth(fc.width || 640);
                if (img.getScaledHeight() < (fc.height || 360)) {
                    img.scaleToHeight(fc.height || 360);
                }
                img.set({ left: 0, top: 0, originX: 'left', originY: 'top' });
                fc.setBackgroundImage(img, () => fc.renderAll());
            }, { crossOrigin: 'anonymous' });
        },

        removeSelected() {
            const fc = fabricRef.current;
            if (!fc) return;
            const active = fc.getActiveObject();
            if (!active) return;
            const id = active._oid;
            fc.remove(active);
            overlaysRef.current = overlaysRef.current.filter(o => o.id !== id);
            fc.renderAll();
            notify();
        },

        updateTiming(id, startTime, endTime) {
            const e = overlaysRef.current.find(o => o.id === id);
            if (e) { e.startTime = startTime; e.endTime = endTime; notify(); }
        },

        clearAll() {
            const fc = fabricRef.current;
            if (!fc) return;
            fc.clear();
            overlaysRef.current = [];
            notify();
        },

        setBgColor(color) {
            const fc = fabricRef.current;
            if (!fc) return;
            fc.setBackgroundColor(color || '', () => fc.renderAll());
        },

        getJSON() {
            const fc = fabricRef.current;
            if (!fc) return null;
            return {
                canvas:   fc.toJSON(['_oid']),
                overlays: overlaysRef.current.map(({ id, label, startTime, endTime }) => ({ id, label, startTime, endTime })),
            };
        },

        loadJSON(snapshot) {
            const fc = fabricRef.current;
            if (!fc || !snapshot?.canvas) return Promise.resolve();
            return new Promise(resolve => {
                fc.loadFromJSON(snapshot.canvas, () => {
                    overlaysRef.current = [];
                    fc.getObjects().forEach(obj => {
                        if (!obj._oid) return;
                        const meta = (snapshot.overlays || []).find(m => m.id === obj._oid);
                        overlaysRef.current.push({
                            id:        obj._oid,
                            label:     meta?.label     ?? obj._oid,
                            fabricObj: obj,
                            startTime: meta?.startTime ?? 0,
                            endTime:   meta?.endTime   ?? 9999,
                        });
                    });
                    fc.renderAll();
                    notify();
                    resolve();
                });
            });
        },
    }));

    return (
        // This wrapper is the absolutely-positioned element.
        // Fabric.js creates .canvas-container INSIDE here, which keeps positioning intact.
        <div
            ref={wrapperRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width:  `${width  || 640}px`,
                height: `${height || 360}px`,
                pointerEvents: 'auto',
                zIndex: 10,
            }}
        >
            <canvas ref={canvasEl} />
        </div>
    );
});

export default OverlayCanvas;
