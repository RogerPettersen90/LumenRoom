import { useState } from "react";
import { exportSidecar } from "@/api/commands";
import { useDevelopStore } from "@/store/developStore";

type Status = "idle" | "working" | "done" | "error";

/**
 * Writes an XMP sidecar next to the original so darktable / the classic editor /
 * RawTherapee can read the current edits. Visible in the top bar in Develop.
 */
export function SidecarButton() {
  const imageId = useDevelopStore((s) => s.imageId);
  const [status, setStatus] = useState<Status>("idle");

  if (!imageId) return null;

  const handleWrite = async () => {
    setStatus("working");
    try {
      await exportSidecar(imageId);
      setStatus("done");
      window.setTimeout(() => setStatus("idle"), 2500);
    } catch (e) {
      console.error("sidecar write failed:", e);
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 4000);
    }
  };

  const label =
    status === "working"
      ? "Writing…"
      : status === "done"
      ? "XMP written ✓"
      : status === "error"
      ? "XMP failed"
      : "Write XMP";

  return (
    <button onClick={handleWrite} disabled={status === "working"} title="Write .xmp sidecar next to the original">
      {label}
    </button>
  );
}
