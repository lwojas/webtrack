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
// opts: { width, height (drawing units, matching the SVG viewBox behind), minDb, maxDb, fill, stroke }.
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
    const analyzer = new SpectrumAnalyzer();
    const pts = new Float32Array(analyzer.columns * 2);
    let feed = null;
    let raf = 0;

    const loop = (now) => {
      if (!feed) {
        const tap = resolveRef.current();
        if (tap) feed = new SpectrumFeed(tap.source, tap.bus, tap.effect, analyzer);
      }
      if ((feed && feed.frame(now)) || surface.dirty) {
        const o = optsRef.current;
        const ctx = surface.begin();
        if (ctx) {
          spectrumPoints(analyzer, surface.width, surface.height, o.minDb, o.maxDb, pts);
          paintSpectrum(ctx, pts, analyzer.columns, surface.height, o);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      surface.dispose();
      if (feed) feed.dispose();
    };
  }, [canvasRef, key]);
}
