import { ImageCanvas } from "./ImageCanvas";

/**
 * Develop module, center work area: just the GPU canvas. Panel groups and the
 * filmstrip are provided by the app shell.
 */
export function DevelopView() {
  return <ImageCanvas />;
}
