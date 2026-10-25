// Shared drawing vocabulary for dB-scaled displays. A spectrum and a level meter are the same
// picture: a filled area under a line on a dB scale, with a danger zone drawn in a warning colour.
// Painters know nothing about audio sources, EQ or the mixer; they take already mapped geometry
// (webdsp's spectrumPoints / peakToUnit) and colours. Mirrors webseq src/viz/paint.ts.

// Filled area plus outline through `columns` x,y pairs (drawing units, y down).
// style: { fill, stroke }
export function paintSpectrum(ctx, pts, columns, height, style) {
  const last = columns - 1;
  ctx.beginPath();
  ctx.moveTo(pts[0], height);
  for (let i = 0; i <= last; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  ctx.lineTo(pts[2 * last], height);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i <= last; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// A vertical level bar filling the drawing area from the bottom, on the same dB scale as the spectrum.
// bar:   { unit (0..1 level), redUnit (0..1 where the danger zone starts), ticks (0..1[]), clipping }
// style: { track, fill, danger (above redUnit and the clip cap), tick }
export function paintLevelBar(ctx, w, h, bar, style) {
  const y = (u) => h * (1 - u);
  ctx.fillStyle = style.track;
  ctx.fillRect(0, 0, w, h);
  const top = y(bar.unit);
  const redY = y(bar.redUnit);
  ctx.fillStyle = style.fill;
  ctx.fillRect(0, Math.max(top, redY), w, h - Math.max(top, redY));
  if (top < redY) {
    ctx.fillStyle = style.danger;
    ctx.fillRect(0, top, w, redY - top);
  }
  ctx.fillStyle = style.tick;
  for (const t of bar.ticks) ctx.fillRect(0, Math.round(y(t)), w, 1);
  if (bar.clipping) {
    ctx.fillStyle = style.danger;
    ctx.fillRect(0, 0, w, Math.min(3, h));
  }
}
