import { useState } from "react";
import { importSidecar } from "@/api/commands";
import { useDevelopStore } from "@/store/developStore";

type Status = "idle" | "working" | "done" | "error";

/** Re-import develop settings from the .xmp sidecar next to the original. */
export function ImportXmpButton() {
  const imageId = useDevelopStore((s) => s.imageId);
  const open = useDevelopStore((s) => s.open);
  const [status, setStatus] = useState<Status>("idle");

  if (!imageId) return null;

  const handle = async () => {
    setStatus("working");
    try {
      await importSidecar(imageId);
      await open(imageId); // reload params + history from the catalog
      setStatus("done");
      window.setTimeout(() => setStatus("idle"), 2500);
    } catch (e) {
      console.error("XMP import failed:", e);
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 4000);
    }
  };

  const label =
    status === "working" ? "Reading…" : status === "done" ? "XMP read ✓" : status === "error" ? "No XMP" : "Read XMP";

  return (
    <button onClick={() => void handle()} disabled={status === "working"} title="Re-import settings from the .xmp sidecar">
      {label}
    </button>
  );
}
