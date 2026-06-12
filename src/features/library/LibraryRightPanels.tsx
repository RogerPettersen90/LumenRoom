import { HistogramPanel } from "./panels/HistogramPanel";
import { QuickDevelopPanel } from "./panels/QuickDevelopPanel";
import { KeywordsPanel } from "./panels/KeywordsPanel";
import { MetadataPanel } from "./panels/MetadataPanel";

/**
 * Library module, right panel group (classic order): Histogram · Quick Develop ·
 * Keywording · Metadata.
 */
export function LibraryRightPanels() {
  return (
    <div className="panel-scroll">
      <HistogramPanel />
      <QuickDevelopPanel />
      <KeywordsPanel />
      <MetadataPanel />
    </div>
  );
}
