import { useEffect, useState } from "react";
import { PanelSection } from "@/components/PanelSection";
import { useCatalogStore, parentDir } from "@/store/catalogStore";
import { getIptc, setIptc } from "@/api/commands";
import type { Iptc } from "@/api/commands";

const EMPTY_IPTC: Iptc = { title: null, caption: null, copyright: null, creator: null };

/** the classic editor's Metadata panel: file + EXIF details, plus editable IPTC. */
export function MetadataPanel() {
  const image = useCatalogStore((s) => (s.selectedId ? s.byId[s.selectedId] : null));
  const [iptc, setLocal] = useState<Iptc>(EMPTY_IPTC);

  useEffect(() => {
    if (!image) {
      setLocal(EMPTY_IPTC);
      return;
    }
    let cancelled = false;
    void getIptc(image.id)
      .then((v) => !cancelled && setLocal(v))
      .catch(() => setLocal(EMPTY_IPTC));
    return () => {
      cancelled = true;
    };
  }, [image?.id]);

  const saveField = (key: keyof Iptc, value: string) => {
    if (!image) return;
    const next = { ...iptc, [key]: value.trim() || null };
    setLocal(next);
    void setIptc(image.id, next);
  };

  if (!image) {
    return (
      <PanelSection title="Metadata">
        <p className="panel-muted">No photo selected.</p>
      </PanelSection>
    );
  }

  const rows: [string, string | null][] = [
    ["File Name", image.filename],
    ["Folder", parentDir(image.path).split("/").pop() ?? null],
    ["Format", image.format.toUpperCase()],
    [
      "Capture Date",
      image.capturedAt ? new Date(image.capturedAt * 1000).toLocaleString() : null,
    ],
    ["Camera", image.cameraModel],
    ["Lens", image.lens],
    ["ISO", image.iso != null ? String(image.iso) : null],
    ["Aperture", image.aperture != null ? `f/${image.aperture}` : null],
    ["Shutter", image.shutter],
    [
      "Focal Length",
      image.focalLength != null ? `${Math.round(image.focalLength)} mm` : null,
    ],
    ["Rating", image.rating > 0 ? "★".repeat(image.rating) : null],
    ["Label", image.colorLabel],
  ];

  const iptcField = (label: string, key: keyof Iptc) => (
    <label className="iptc-row" key={key}>
      <span>{label}</span>
      <input
        type="text"
        value={iptc[key] ?? ""}
        onChange={(e) => setLocal({ ...iptc, [key]: e.target.value })}
        onBlur={(e) => saveField(key, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="—"
      />
    </label>
  );

  return (
    <PanelSection title="Metadata">
      <h4 className="kw-list-title">IPTC</h4>
      {iptcField("Title", "title")}
      {iptcField("Caption", "caption")}
      {iptcField("Copyright", "copyright")}
      {iptcField("Creator", "creator")}

      <h4 className="kw-list-title">EXIF</h4>
      <dl className="metadata-list">
        {rows
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => (
            <div className="meta-row" key={k}>
              <dt>{k}</dt>
              <dd title={v ?? ""}>{v}</dd>
            </div>
          ))}
      </dl>
    </PanelSection>
  );
}
