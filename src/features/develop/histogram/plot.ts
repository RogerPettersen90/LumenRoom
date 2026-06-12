// Shared histogram machinery: the data shape, the canvas plotting routine
// (additive RGB, like every photo editor), and a CPU fallback that computes a
// histogram from a decoded <img> (used by the Library panel, where there is no
// WebGL surface to read back from).

export interface HistogramData {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

export const HIST_W = 256;
export const HIST_H = 96;

export function drawHistogram(
  canvas: HTMLCanvasElement | null,
  data: HistogramData | null
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, HIST_W, HIST_H);
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, HIST_W, HIST_H);

  if (!data) return;

  // Normalise against the tallest bin across all channels, ignoring the pure
  // black/white spikes (bins 0 and 255) which would otherwise flatten the rest.
  const peak = Math.max(1, channelPeak(data.r), channelPeak(data.g), channelPeak(data.b));

  ctx.globalCompositeOperation = "lighter";
  plotChannel(ctx, data.r, peak, "rgba(229, 72, 77, 0.85)");
  plotChannel(ctx, data.g, peak, "rgba(62, 207, 106, 0.85)");
  plotChannel(ctx, data.b, peak, "rgba(74, 158, 255, 0.85)");
  ctx.globalCompositeOperation = "source-over";
}

/** Bin a decoded image into a 256-level RGB histogram via an offscreen canvas. */
export function computeHistogramFromImage(img: HTMLImageElement): HistogramData | null {
  // Downsample to a small working surface; plenty for histogram statistics.
  const w = Math.min(img.naturalWidth, 256);
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w) || 1);

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let px: Uint8ClampedArray;
  try {
    px = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas (shouldn't happen: lumen:// sends ACAO:*)
  }

  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    r[px[i]]++;
    g[px[i + 1]]++;
    b[px[i + 2]]++;
  }
  return { r, g, b };
}

function channelPeak(bins: Uint32Array): number {
  let max = 0;
  for (let i = 1; i < 255; i++) if (bins[i] > max) max = bins[i];
  return max;
}

function plotChannel(
  ctx: CanvasRenderingContext2D,
  bins: Uint32Array,
  peak: number,
  color: string
): void {
  ctx.beginPath();
  ctx.moveTo(0, HIST_H);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * HIST_W;
    const y = HIST_H - Math.min(1, bins[i] / peak) * HIST_H;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(HIST_W, HIST_H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
