import type { HistogramData } from "./plot";

// A tiny pub/sub channel that decouples the GPU render loop from React. The
// renderer publishes fresh histogram data after each draw; the Histogram
// component subscribes and redraws to its own canvas — no React state churn at
// 60fps, and no ordering coupling between the two components.

type Listener = (data: HistogramData | null) => void;

const listeners = new Set<Listener>();
let last: HistogramData | null = null;

export const histogramBus = {
  publish(data: HistogramData | null) {
    last = data;
    for (const l of listeners) l(data);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(last); // deliver the current frame immediately
    return () => {
      listeners.delete(listener);
    };
  },
};
