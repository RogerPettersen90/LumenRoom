#!/usr/bin/env bash
# Fails if third-party trademarks sneak back into code or docs.
# Allowed only: "Adobe RGB"/"AdobeRGB"/"AdobeCompat" (color-space standard
# names) and adobe.com / adobe:ns namespace URIs (XMP interop). No brand
# comparisons or disclaimers anywhere, including the README.
set -e
hits=$(grep -rn "Lightroom" src src-tauri/src README.md ROADMAP.md PROJECT_STATUS.md 2>/dev/null || true)
adobe=$(grep -rn "Adobe" src src-tauri/src README.md ROADMAP.md PROJECT_STATUS.md 2>/dev/null | grep -viE "adobe ?rgb|adobecompat|adobe\.com|adobe:ns" || true)
if [ -n "$hits$adobe" ]; then
  echo "Trademark check FAILED:"; echo "$hits"; echo "$adobe"; exit 1
fi
echo "Trademark check passed."
