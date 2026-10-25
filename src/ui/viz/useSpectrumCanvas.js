import { useEffect, useRef } from "react";
import { SpectrumAnalyzer, SpectrumFeed, spectrumPoints } from "webdsp";
import { CanvasSurface } from "./canvasSurface.js";
import { paintSpectrum } from "./paint.js";

// Paints a live spectrum into `canvasRef` while mounted. All work is outside React: one
// requestAnimationFrame loop that only touches the canvas, never state, so it cannot cause a React
// render and runs only while this view exists (rAF pauses with the tab). It redraws only when the
// spectrum changed, and does nothing once it has fallen to silence.
//
// resolve(): () => ({ source, bus, effect }) | null, polled until the engine effect exists (the
// engine starts lazily). `key` re-attaches the display when the tapped effect changes.
// opts: { width, height (drawing units, matching the SVG viewBox behind), minDb, maxDb,
//         main: { fill, stroke } (the effect's OUTPUT, the brighter fill),
//         input?: { fill, stroke } (the effect's INPUT, fainter behind it; omit to show only the output) }.
// Mirrors webseq src/viz/useSpectrumCanvas.ts.
export function useSpectrumCanvas(canvasRef, resolve, key, opts) {
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const surface = new CanvasSurface(canvas, { width: optsRef.current.width, height: optsRef.current.height });
    const output = new SpectrumAnalyzer();
    const input = new SpectrumAnalyzer();
    const pts = new Float32Array(output.columns * 2);
    let outFeed = null;
    let inFeed = null;
    let raf = 0;

    const paint = (ctx, a, style) => {
      const o = optsRef.current;
      spectrumPoints(a, surface.width, surface.height, o.minDb, o.maxDb, pts);
      paintSpectrum(ctx, pts, a.columns, surface.height, style);
    };

    const loop = (now) => {
      if (!outFeed) {
        const tap = resolveRef.current();
        if (tap) {
          outFeed = new SpectrumFeed(tap.source, tap.bus, tap.effect, true, output);
          if (optsRef.current.input) inFeed = new SpectrumFeed(tap.source, tap.bus, tap.effect, false, input);
        }
      }
      const outChanged = outFeed ? outFeed.frame(now) : false;
      const inChanged = inFeed ? inFeed.frame(now) : false;
      if (outChanged || inChanged || surface.dirty) {
        const o = optsRef.current;
        const ctx = surface.begin();
        if (ctx) {
          if (inFeed && o.input) paint(ctx, input, o.input);
          paint(ctx, output, o.main);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      surface.dispose();
      if (outFeed) outFeed.dispose();
      if (inFeed) inFeed.dispose();
    };
  }, [canvasRef, key]);
}
