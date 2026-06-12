#!/usr/bin/env bash
# Fails if third-party trademarks sneak back into code or docs.
# Allowed: "Adobe RGB"/"AdobeRGB"/"AdobeCompat" (color-space standard names),
# adobe.com namespace URIs (XMP interop), and the deliberate nominative
# comparison + disclaimer lines (marked by ® or "Adobe Inc").
set -e
hits=$(grep -rn "Lightroom" src src-tauri/src README.md ROADMAP.md PROJECT_STATUS.md 2>/dev/null | grep -vE "®|Adobe Inc" || true)
adobe=$(grep -rn "Adobe" src src-tauri/src ROADMAP.md PROJECT_STATUS.md 2>/dev/null | grep -viE "adobe ?rgb|adobecompat|adobe\.com|adobe inc|®" || true)
if [ -n "$hits$adobe" ]; then
  echo "Trademark check FAILED:"; echo "$hits"; echo "$adobe"; exit 1
fi
echo "Trademark check passed."
