// Second-window support (the classic F11 second monitor): a separate webview showing
// a clean Loupe of the active photo. The main window broadcasts selection via
// Tauri events (separate webviews share no JS state); the second window only
// listens and renders — all interaction stays in the main window.

import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { fullUrl, previewUrl } from "@/api/protocol";

const EVT = "second-window-photo";

export interface SecondPhoto {
  id: string;
  filename: string;
}

/** Main window: broadcast the active photo to the second window. */
export function broadcastToSecond(photo: SecondPhoto | null): void {
  void emit(EVT, photo).catch(() => undefined);
}

/** Main window: open the second window, or close it if it's already up. */
export async function toggleSecondWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("second");
  if (existing) {
    await existing.close();
    return;
  }
  const w = new WebviewWindow("second", {
    url: "index.html?second=1",
    title: "LumenRoom — Second Window",
    width: 1280,
    height: 800,
  });
  // Once it's ready, re-broadcast so it doesn't open blank.
  void w.once("tauri://created", () => {
    window.setTimeout(() => {
      const s = lastSent;
      if (s) broadcastToSecond(s);
    }, 600);
  });
}

let lastSent: SecondPhoto | null = null;
export function rememberBroadcast(p: SecondPhoto | null): void {
  lastSent = p;
}

/** The second window's entire UI (mounted when ?second=1). */
export function SecondWindowView() {
  const [photo, setPhoto] = useState<SecondPhoto | null>(null);
  const [tier, setTier] = useState<"std" | "full">("std");

  useEffect(() => {
    const un = listen<SecondPhoto | null>(EVT, (e) => {
      setPhoto(e.payload);
      setTier("std");
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  return (
    <div className="second-window">
      {photo ? (
        <>
          <img
            src={tier === "full" ? fullUrl(photo.id) : previewUrl(photo.id)}
            alt={photo.filename}
            onDoubleClick={() => setTier(tier === "full" ? "std" : "full")}
            title="Double-click for 1:1"
          />
          <div className="second-meta">
            {photo.filename}
            {tier === "full" && <span className="tier-badge">1:1</span>}
          </div>
        </>
      ) : (
        <div className="empty">Select a photo in the main window.</div>
      )}
    </div>
  );
}
