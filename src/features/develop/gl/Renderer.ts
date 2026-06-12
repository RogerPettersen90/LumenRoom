import type { EditParams } from "@/types/models";
import type { HistogramData } from "../histogram/plot";
import { bakeCurveLut, bakeCurveLuts } from "../curve";
import { profileLook } from "../profiles";
import { bakeHslLut } from "../hsl";
import { calibrationIsIdentity, calibrationMatrix } from "../calibration";
import { hslIsIdentity, NEUTRAL_EDIT } from "@/types/models";

export type { HistogramData };

// WebGL1 interactive develop renderer. Uploads the edit proxy (currently the
// cached thumbnail) once as a texture, then re-applies the full adjustment
// stack as a single fragment-shader pass on every slider change — no CPU pixel
// work, no IPC round-trip. The Rust pipeline is only needed for the final
// high-quality / full-resolution render on export.

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;     // [-1,1] clip -> [0,1] uv
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_curve;   // 256x1 tone-curve LUT (identity when untouched)
uniform sampler2D u_hsl;     // 360x1 hue-indexed mixer LUT
uniform float u_hslOn;       // skip the HSV roundtrip when the mixer is neutral

// Color grading: per zone (hue 0..1, sat 0..1, lum -1..1) + pivot balance.
uniform vec3 u_gradeS;
uniform vec3 u_gradeM;
uniform vec3 u_gradeH;
uniform float u_gradeBalance;

uniform float u_bw;          // treatment: black & white
uniform float u_vigAmt;      // vignette amount -1..1
uniform float u_vigMid;      // vignette midpoint 0..1
uniform float u_grain;       // grain amount 0..1
uniform float u_sharpen;     // unsharp amount 0..1
uniform vec2 u_texel;        // 1/imageSize, for neighbor sampling
uniform float u_nrLum;       // luminance NR 0..1
uniform float u_nrCol;       // color NR 0..1

// Local adjustment masks (max 4). Geometry in straightened-frame coords.
uniform float u_maskCount;
uniform vec4 u_maskGeo[4];   // x0,y0,x1,y1 (linear ends / radial center+radii)
uniform vec4 u_maskAdj[4];   // exposure EV, contrast, saturation, temperature
uniform vec4 u_maskMeta[4];  // tint, feather, invert(0/1), kind(0=lin,1=rad,2=brush,3=raster)
uniform sampler2D u_rasterTex; // raster mask weight map (frame space, top-down)
uniform float u_rasterIdx;     // which mask slot samples u_rasterTex (-1 = none)
uniform float u_maskView;      // mask slot to visualize green (-1 = off)
uniform vec4 u_maskRngA[4];  // rangeType(0/1/2), lo, hi, soft
uniform vec4 u_maskRngB[4];  // hue01, tolerance, radialRotation(rad), -

// Brush mask stroke (one brush supported in the live preview; export
// supports all). Points in frame coords; geo.z carries the stroke radius.
uniform vec2 u_brushPts[24];
uniform float u_brushN;

// Geometry: crop rect (x,y,w,h normalized), straighten angle + auto-zoom.
// MUST match apply_geometry in src-tauri/src/imaging/pipeline.rs.
uniform vec4 u_cropRect;
uniform float u_angle;       // radians
uniform float u_zoom;        // 1 / straightenScale
uniform float u_aspect;      // image W/H

uniform float u_exposure;    // EV
uniform float u_contrast;    // -1..1
uniform float u_highlights;  // -1..1
uniform float u_shadows;     // -1..1
uniform float u_whites;      // -1..1
uniform float u_blacks;      // -1..1
uniform float u_temp;        // -1..1
uniform float u_tint;        // -1..1
uniform float u_saturation;  // -1..1
uniform float u_profSat;     // profile base saturation multiplier (1 = neutral)
uniform float u_vibrance;    // -1..1
uniform float u_clarity;     // -1..1
uniform float u_dehaze;      // -1..1
uniform float u_sharpenMask; // 0..1 edge masking
uniform float u_texture;     // -1..1 mid-frequency presence
uniform float u_detail;      // detail-tap stretch: texels per displayed pixel
uniform float u_clip;        // clipping overlay (J): paint clipped pixels

// Calibration: primaries-remap matrix columns (identity when untouched).
uniform float u_calOn;
uniform vec3 u_calR;
uniform vec3 u_calG;
uniform vec3 u_calB;

// Lateral CA correction: radial scale of R/B sampling about the lens axis.
uniform float u_distort;     // manual distortion correction coefficient
uniform vec3 u_lensABC;      // lensfun ptlens cubic (a, b, c); 0 = off
uniform float u_caR;
uniform float u_caB;

// Transform: perspective keystone coefficients (±0.35).
uniform float u_perspV;
uniform float u_perspH;

// Heal/clone spots (frame coords; preview renders the first 8).
uniform vec4 u_spotA[8]; // dst.xy, src.xy
uniform vec4 u_spotB[8]; // radius, heal(0/1), feather, -
uniform float u_spotN;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toGamma(vec3 c)  { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float luma(vec3 c)    { return dot(c, LUMA); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Frame coords (top-down) -> texture uv, through keystone + straighten zoom +
// rotation. The single mapping serves the base sample AND heal/clone spots.
// MUST match map_frame in pipeline.rs.
vec2 geoMap(vec2 ftd) {
  vec2 pf = ftd;
  if (u_perspV != 0.0 || u_perspH != 0.0) {
    float pxc = pf.x - 0.5;
    float pyc = pf.y - 0.5;
    float pd = max(1.0 - u_perspV * pyc - u_perspH * pxc, 0.1);
    pf = vec2(pxc / pd + 0.5, pyc / pd + 0.5);
  }
  vec2 d = vec2(pf.x - 0.5, 0.5 - pf.y) * u_zoom;
  d.x *= u_aspect;
  float cs = cos(u_angle);
  float sn = sin(u_angle);
  d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  d.x /= u_aspect;
  vec2 src = d + 0.5;
  if (u_lensABC != vec3(0.0)) {
    // Lens-profile correction (lensfun ptlens cubic), r normalized to
    // min(w,h)/2. MUST match map_frame in pipeline.rs.
    vec2 ld = src - 0.5;
    vec2 ldPx = vec2(ld.x / u_texel.x, ld.y / u_texel.y);
    float lnorm = 0.5 * min(1.0 / u_texel.x, 1.0 / u_texel.y);
    float lr = length(ldPx) / lnorm;
    float lden = 1.0 - u_lensABC.x - u_lensABC.y - u_lensABC.z;
    float lf = u_lensABC.x * lr * lr * lr + u_lensABC.y * lr * lr + u_lensABC.z * lr + lden;
    src = 0.5 + ld * lf;
  }
  if (u_distort != 0.0) {
    // Lens distortion correction: radial r^2 remap about the lens axis in
    // source space, r normalized by the half-diagonal (pixel-space metric).
    // MUST match map_frame in pipeline.rs.
    vec2 dd = src - 0.5;
    vec2 ddPx = vec2(dd.x / u_texel.x, dd.y / u_texel.y);
    float diag2 = 0.25 * (1.0 / (u_texel.x * u_texel.x) + 1.0 / (u_texel.y * u_texel.y));
    float r2 = dot(ddPx, ddPx) / diag2;
    src = 0.5 + dd * (1.0 + u_distort * r2);
  }
  return src;
}

void main() {
  // --- Geometry: output uv -> crop window -> auto-zoom -> rotate -> source ---
  // The crop rect is stored top-down (image convention, same as the Rust
  // pipeline); v_uv is GL y-up. Convert to centered y-up coords, rotate, and
  // sample (FLIP_Y texture upload makes GL y-up match the image right-side-up).
  float ftdY = u_cropRect.y + (1.0 - v_uv.y) * u_cropRect.w;
  // Straightened-frame uv (top-down) — the coordinate space masks live in.
  vec2 frameUv = vec2(u_cropRect.x + v_uv.x * u_cropRect.z, ftdY);

  // Geometry (keystone + zoom + rotation) via the shared mapping.
  vec2 src = geoMap(frameUv);

  vec3 col = texture2D(u_tex, src).rgb;

  // --- Lateral CA: resample R/B radially about the center (matches the
  //     per-channel sampling in apply_geometry, pipeline.rs) ---
  if (u_caR != 0.0 || u_caB != 0.0) {
    vec2 cc2 = vec2(0.5);
    col.r = texture2D(u_tex, cc2 + (src - cc2) * (1.0 + u_caR)).r;
    col.b = texture2D(u_tex, cc2 + (src - cc2) * (1.0 + u_caB)).b;
  }

  // --- Heal/clone spots (matches the spot pass in apply_geometry) ---
  for (int i = 0; i < 8; i++) {
    if (float(i) >= u_spotN) { break; }
    vec4 spA = u_spotA[i];
    float sr = max(u_spotB[i].x, 0.003);
    float swgt = 1.0 - smoothstep(sr * (1.0 - clamp(u_spotB[i].z, 0.0, 0.95)), sr,
                                  distance(frameUv, spA.xy));
    if (swgt > 0.003) {
      vec2 soff = spA.zw - spA.xy;
      vec3 cl = texture2D(u_tex, geoMap(frameUv + soff)).rgb;
      if (u_spotB[i].y > 0.5) {
        vec2 e1 = vec2(0.004, 0.0);
        vec2 e2 = vec2(0.0, 0.004);
        vec3 dbl = (texture2D(u_tex, geoMap(frameUv + e1)).rgb
                  + texture2D(u_tex, geoMap(frameUv - e1)).rgb
                  + texture2D(u_tex, geoMap(frameUv + e2)).rgb
                  + texture2D(u_tex, geoMap(frameUv - e2)).rgb) * 0.25;
        vec3 sbl = (texture2D(u_tex, geoMap(frameUv + soff + e1)).rgb
                  + texture2D(u_tex, geoMap(frameUv + soff - e1)).rgb
                  + texture2D(u_tex, geoMap(frameUv + soff + e2)).rgb
                  + texture2D(u_tex, geoMap(frameUv + soff - e2)).rgb) * 0.25;
        cl = clamp(cl + (dbl - sbl), 0.0, 1.0);
      }
      col = mix(col, cl, swgt);
    }
  }

  // --- Detail: noise reduction + sharpening (preview approximations over a
  //     4-tap cross; export does full 5x5/3x3 passes in pipeline.rs).
  //     Taps stretch with u_detail (texels per DISPLAYED pixel) so the
  //     effect stays visible when the native-res texture is viewed at fit,
  //     converging to the exact kernel at 100%. ---
  if (u_sharpen > 0.0 || u_nrLum > 0.0 || u_nrCol > 0.0 || u_texture != 0.0) {
    vec2 dt = u_texel * u_detail;
    vec3 t1 = texture2D(u_tex, src + vec2(dt.x, 0.0)).rgb;
    vec3 t2 = texture2D(u_tex, src - vec2(dt.x, 0.0)).rgb;
    vec3 t3 = texture2D(u_tex, src + vec2(0.0, dt.y)).rgb;
    vec3 t4 = texture2D(u_tex, src - vec2(0.0, dt.y)).rgb;

    if (u_nrLum > 0.0 || u_nrCol > 0.0) {
      float cl = luma(col);
      float w1 = exp(-pow(luma(t1) - cl, 2.0) / 0.0128);
      float w2 = exp(-pow(luma(t2) - cl, 2.0) / 0.0128);
      float w3 = exp(-pow(luma(t3) - cl, 2.0) / 0.0128);
      float w4 = exp(-pow(luma(t4) - cl, 2.0) / 0.0128);
      vec3 bil = (col + t1 * w1 + t2 * w2 + t3 * w3 + t4 * w4) / (1.0 + w1 + w2 + w3 + w4);
      col = mix(col, bil, u_nrLum);
      vec3 avg = (t1 + t2 + t3 + t4 + col) * 0.2;
      vec3 chr = vec3(luma(col)) + (avg - vec3(luma(avg)));
      col = mix(col, chr, u_nrCol);
    }

    vec3 blur = (t1 + t2 + t3 + t4 + col * 4.0) / 8.0;

    // Texture preview approximation (export uses a true two-scale band).
    if (u_texture != 0.0) {
      col += u_texture * 0.5 * (col - blur);
    }

    if (u_sharpen > 0.0) {
      float edgeW = 1.0;
      if (u_sharpenMask > 0.0) {
        float e = abs(luma(col) - luma(blur));
        edgeW = smoothstep(0.015 * u_sharpenMask, 0.06 * u_sharpenMask, e);
      }
      col += u_sharpen * 1.2 * edgeW * (col - blur);
    }
  }

  // --- White balance + exposure in linear light ---
  vec3 lin = toLinear(col);

  // --- Calibration (primaries remap, linear, before WB — matches pipeline.rs) ---
  if (u_calOn > 0.5) {
    lin = lin.r * u_calR + lin.g * u_calG + lin.b * u_calB;
  }
  lin.r *= (1.0 + 0.22 * u_temp - 0.06 * u_tint);
  lin.b *= (1.0 - 0.22 * u_temp - 0.06 * u_tint);
  lin.g *= (1.0 + 0.12 * u_tint);
  lin *= pow(2.0, u_exposure);
  col = toGamma(lin);

  // --- Tone regions (display gamma), hue-preserving: scale all channels by
  //     new_luma/old_luma so Highlights recovery keeps color instead of
  //     washing grey. MUST match pipeline.rs. ---
  float l = luma(col);
  float shadowMask = 1.0 - smoothstep(0.0, 0.5, l);
  float highMask   = smoothstep(0.5, 1.0, l);
  float region = u_shadows    * 0.40 * shadowMask
               + u_highlights * 0.40 * highMask
               + u_blacks * 0.18 * (1.0 - smoothstep(0.0, 0.45, l))
               + u_whites * 0.18 * smoothstep(0.55, 1.0, l);
  if (region != 0.0 && l > 1e-4) {
    col *= min(max(l + region, 0.0) / l, 8.0);
  }

  // --- Contrast around mid grey ---
  col = (col - 0.5) * (1.0 + u_contrast) + 0.5;

  // --- Dehaze (matches pipeline.rs: veil subtract + slope + sat lift) ---
  if (u_dehaze != 0.0) {
    float veil = u_dehaze * 0.12;
    float denom = max(1.0 - veil, 0.05);
    float dk = 1.0 + 0.25 * u_dehaze;
    col = ((col - veil) / denom - 0.5) * dk + 0.5;
    float dl2 = luma(col);
    col = mix(vec3(dl2), col, 1.0 + 0.12 * u_dehaze);
  }

  // --- Point tone curve (after contrast, before color — matches pipeline.rs) ---
  col = clamp(col, 0.0, 1.0);
  col.r = texture2D(u_curve, vec2(col.r, 0.5)).r;
  col.g = texture2D(u_curve, vec2(col.g, 0.5)).g;
  col.b = texture2D(u_curve, vec2(col.b, 0.5)).b;

  // --- B&W treatment: collapse to luma before the color stages (matches
  //     pipeline.rs; split-toning via grading still applies after). ---
  if (u_bw > 0.5) {
    col = vec3(luma(col));
  }

  // --- Saturation (user slider x profile base multiplier) + vibrance ---
  float lg = luma(col);
  col = mix(vec3(lg), col, (1.0 + u_saturation) * u_profSat);
  float sat = max(max(col.r, col.g), col.b) - min(min(col.r, col.g), col.b);
  col = mix(vec3(lg), col, 1.0 + u_vibrance * (1.0 - sat));

  // --- HSL / Color Mixer (after vibrance, before clarity — matches pipeline.rs).
  //     Weighted by pixel saturation so neutrals never pick up a cast. ---
  if (u_hslOn > 0.5) {
    vec3 hsv = rgb2hsv(clamp(col, 0.0, 1.0));
    vec3 adj = texture2D(u_hsl, vec2(hsv.x, 0.5)).rgb;
    float shiftDeg = (adj.r - 0.5) * 60.0;
    float satMul = adj.g * 2.0;
    float lumMul = adj.b + 0.5;
    float w = smoothstep(0.0, 0.15, hsv.y);
    hsv.x = fract(hsv.x + shiftDeg * w / 360.0);
    hsv.y = clamp(hsv.y * (1.0 + (satMul - 1.0) * w), 0.0, 1.0);
    hsv.z = clamp(hsv.z * (1.0 + (lumMul - 1.0) * w), 0.0, 1.0);
    col = hsv2rgb(hsv);
  }

  // --- Color grading (3-way split tone, after mixer / before clarity).
  //     Constants (0.3 tint, 0.25 lum) matched with pipeline.rs. ---
  {
    float l2 = clamp(luma(col), 0.0, 1.0);
    float pivot = clamp(0.5 + 0.25 * u_gradeBalance, 0.05, 0.95);
    float wgh = smoothstep(pivot, 1.0, l2);
    float wgs = 1.0 - smoothstep(0.0, pivot, l2);
    float wgm = max(0.0, 1.0 - wgs - wgh);
    col += wgs * u_gradeS.y * 0.3 * (hsv2rgb(vec3(u_gradeS.x, 1.0, 1.0)) - 0.5);
    col += wgm * u_gradeM.y * 0.3 * (hsv2rgb(vec3(u_gradeM.x, 1.0, 1.0)) - 0.5);
    col += wgh * u_gradeH.y * 0.3 * (hsv2rgb(vec3(u_gradeH.x, 1.0, 1.0)) - 0.5);
    col += vec3(wgs * u_gradeS.z + wgm * u_gradeM.z + wgh * u_gradeH.z) * 0.25;
  }

  // --- Clarity: approximate midtone local-contrast (no blur pass yet) ---
  float mid = 1.0 - abs(lg - 0.5) * 2.0;
  col += u_clarity * 0.30 * (col - 0.5) * mid;

  // --- Local adjustment masks (matches apply_masks in pipeline.rs) ---
  float viewW = 0.0; // weight of the mask being visualized (u_maskView)
  for (int i = 0; i < 4; i++) {
    if (float(i) >= u_maskCount) { break; }
    vec4 geo = u_maskGeo[i];
    vec4 adj = u_maskAdj[i];
    vec4 meta = u_maskMeta[i];

    float wgt;
    if (meta.w > 3.5) {
      // Global: whole frame; the range refinement below does the shaping.
      wgt = 1.0;
    } else if (meta.w > 2.5) {
      // Raster: weight map sampled in frame space (preview budget: 1 map).
      wgt = (abs(float(i) - u_rasterIdx) < 0.5)
          ? texture2D(u_rasterTex, frameUv).r
          : 0.0;
    } else if (meta.w > 1.5) {
      // Brush: distance to the stroke polyline, falloff over the radius.
      float bdist = 1e9;
      if (u_brushN < 1.5) {
        bdist = distance(frameUv, u_brushPts[0]);
      } else {
        for (int s = 0; s < 23; s++) {
          if (float(s + 1) >= u_brushN) { break; }
          vec2 ba = u_brushPts[s];
          vec2 bb = u_brushPts[s + 1];
          vec2 ab = bb - ba;
          float bl2 = max(dot(ab, ab), 1e-8);
          float bt = clamp(dot(frameUv - ba, ab) / bl2, 0.0, 1.0);
          bdist = min(bdist, distance(frameUv, ba + bt * ab));
        }
      }
      float br = max(geo.z, 0.005);
      wgt = (u_brushN < 0.5) ? 0.0
          : 1.0 - smoothstep(br * (1.0 - clamp(meta.y, 0.0, 0.99)), br, bdist);
    } else if (meta.w < 0.5) {
      // Linear: full effect at (x0,y0), fading to none at (x1,y1); feather
      // sets the transition band (0.5 = whole span). Matches pipeline.rs.
      vec2 dir = geo.zw - geo.xy;
      float len2 = max(dot(dir, dir), 1e-6);
      float t = dot(frameUv - geo.xy, dir) / len2;
      float lf = clamp(meta.y, 0.01, 1.0);
      wgt = 1.0 - smoothstep(0.5 - lf, 0.5 + lf, t);
    } else {
      // Radial: inside the (optionally rotated) ellipse, soft edge by feather.
      float mrot = u_maskRngB[i].z;
      vec2 md = frameUv - geo.xy;
      float mc = cos(mrot);
      float ms = sin(mrot);
      vec2 mdr = vec2(md.x * mc + md.y * ms, -md.x * ms + md.y * mc);
      vec2 nrm = mdr / max(geo.zw, vec2(1e-3));
      wgt = 1.0 - smoothstep(1.0 - clamp(meta.y, 0.0, 0.99), 1.0, length(nrm));
    }
    if (meta.z > 0.5) { wgt = 1.0 - wgt; }

    // Range refinement on the current color (matches range_weight in pipeline.rs).
    vec4 ra = u_maskRngA[i];
    if (ra.x > 0.5 && wgt > 0.001) {
      vec3 cc = clamp(col, 0.0, 1.0);
      if (ra.x < 1.5) {
        float rl = luma(cc);
        float soft = max(ra.w, 0.001);
        wgt *= smoothstep(ra.y - soft, ra.y, rl) * (1.0 - smoothstep(ra.z, ra.z + soft, rl));
      } else {
        vec4 rb = u_maskRngB[i];
        vec3 chsv = rgb2hsv(cc);
        float hd = abs(chsv.x - rb.x);
        if (hd > 0.5) { hd = 1.0 - hd; }
        float tol = max(rb.y, 0.01);
        wgt *= (1.0 - smoothstep(tol * 0.25, tol * 0.5, hd)) * smoothstep(0.05, 0.2, chsv.y);
      }
    }

    if (abs(float(i) - u_maskView) < 0.5) { viewW = wgt; }

    if (wgt > 0.001) {
      float mtemp = adj.w * wgt;
      float mtint = meta.x * wgt;
      float mgain = pow(2.0, adj.x * wgt);
      vec3 mlin = pow(max(col, 0.0), vec3(2.2));
      mlin.r *= (1.0 + 0.22 * mtemp - 0.06 * mtint);
      mlin.g *= (1.0 + 0.12 * mtint);
      mlin.b *= (1.0 - 0.22 * mtemp - 0.06 * mtint);
      mlin *= mgain;
      col = pow(max(mlin, 0.0), vec3(1.0 / 2.2));
      float mk = 1.0 + adj.y * wgt;
      col = (col - 0.5) * mk + 0.5;
      float ml = luma(col);
      col = clamp(mix(vec3(ml), col, 1.0 + adj.z * wgt), 0.0, 1.0);
    }
  }

  // --- Mask visualization (display only): the SAME weight the adjustment
  //     uses, painted green — tint and effect cannot disagree, by
  //     construction (pro editors render their mask overlays in-engine the same way). ---
  if (u_maskView >= 0.0 && viewW > 0.003) {
    col = mix(col, vec3(0.25, 0.95, 0.45), viewW * 0.5);
  }

  // --- Post-crop effects: vignette + grain (output-space, matches
  //     apply_effects in pipeline.rs) ---
  {
    vec2 vc = vec2((v_uv.x - 0.5) * 2.0, (v_uv.y - 0.5) * 2.0);
    float d = length(vc) / 1.41421356;
    col *= 1.0 + u_vigAmt * smoothstep(u_vigMid, 1.0, d);
    float nrand = abs(fract(sin(v_uv.x * 12.9898 + v_uv.y * 78.233) * 43758.5453));
    col += (nrand - 0.5) * u_grain * 0.15;
  }

  // --- Clipping overlay (display-only; never exported) ---
  if (u_clip > 0.5) {
    if (max(col.r, max(col.g, col.b)) >= 0.997) {
      col = vec3(0.9, 0.15, 0.15);
    } else if (min(col.r, min(col.g, col.b)) <= 0.003) {
      col = vec3(0.2, 0.4, 1.0);
    }
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/**
 * Largest uniform scale keeping the original-aspect rect inside the frame
 * rotated by `theta`. MUST match `straighten_scale` in pipeline.rs.
 */
export function straightenScale(w: number, h: number, theta: number): number {
  const t = Math.abs(theta);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}

type UniformName =
  | "u_cropRect"
  | "u_angle"
  | "u_zoom"
  | "u_aspect"
  | "u_hslOn"
  | "u_gradeS"
  | "u_gradeM"
  | "u_gradeH"
  | "u_gradeBalance"
  | "u_bw"
  | "u_vigAmt"
  | "u_vigMid"
  | "u_grain"
  | "u_sharpen"
  | "u_texel"
  | "u_nrLum"
  | "u_nrCol"
  | "u_maskCount"
  | "u_maskGeo"
  | "u_maskAdj"
  | "u_maskMeta"
  | "u_maskRngA"
  | "u_maskRngB"
  | "u_brushPts"
  | "u_brushN"
  | "u_rasterIdx"
  | "u_maskView"
  | "u_exposure"
  | "u_contrast"
  | "u_highlights"
  | "u_shadows"
  | "u_whites"
  | "u_blacks"
  | "u_temp"
  | "u_tint"
  | "u_saturation"
  | "u_profSat"
  | "u_vibrance"
  | "u_clarity"
  | "u_dehaze"
  | "u_sharpenMask"
  | "u_texture"
  | "u_clip"
  | "u_calOn"
  | "u_calR"
  | "u_calG"
  | "u_calB"
  | "u_detail"
  | "u_distort"
  | "u_lensABC"
  | "u_caR"
  | "u_caB"
  | "u_perspV"
  | "u_perspH"
  | "u_spotA"
  | "u_spotB"
  | "u_spotN";

export class DevelopRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<UniformName, WebGLUniformLocation | null>;
  private hasImage = false;
  private imgW = 0;
  private imgH = 0;
  private curveTex: WebGLTexture | null = null;
  private curveKey = ""; // JSON of the curve currently uploaded
  private hslTex: WebGLTexture | null = null;
  private hslKey = ""; // JSON of the mixer values currently uploaded
  private rasterTex: WebGLTexture | null = null;
  private rasterIdx = -1; // mask slot the raster texture belongs to
  /** Texture texels per displayed CSS pixel (≥1); set from the zoom level. */
  viewScale = 1;
  // Last REQUESTED surface size (canvas.width may be smaller if the GL
  // backbuffer was clamped — comparing against canvas would churn).
  private reqW = 0;
  private reqH = 0;
  /** Raster id currently uploaded (callers use it to skip reloads). */
  rasterKey = "";

  constructor(private canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer lets us readPixels for the histogram after drawing.
    const gl = canvas.getContext("webgl", {
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;

    this.program = this.buildProgram(VERT, FRAG);
    gl.useProgram(this.program);

    // Full-screen quad.
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Samplers: image 0, curve LUT 1, HSL LUT 2, raster mask 3.
    gl.uniform1i(gl.getUniformLocation(this.program, "u_tex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_curve"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_hsl"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_rasterTex"), 3);
    this.curveTex = gl.createTexture();
    this.hslTex = gl.createTexture();
    this.uploadLut(this.curveTex, 1, bakeCurveLut([[0, 0], [1, 1]]), 256);
    this.uploadLut(this.hslTex, 2, bakeHslLut(NEUTRAL_EDIT), 360);
    // Raster mask placeholder: 1×1 black (sampling it weighs nothing).
    this.rasterTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.rasterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0])
    );
    gl.activeTexture(gl.TEXTURE0);

    this.uniforms = {
      u_cropRect: gl.getUniformLocation(this.program, "u_cropRect"),
      u_angle: gl.getUniformLocation(this.program, "u_angle"),
      u_zoom: gl.getUniformLocation(this.program, "u_zoom"),
      u_aspect: gl.getUniformLocation(this.program, "u_aspect"),
      u_hslOn: gl.getUniformLocation(this.program, "u_hslOn"),
      u_gradeS: gl.getUniformLocation(this.program, "u_gradeS"),
      u_gradeM: gl.getUniformLocation(this.program, "u_gradeM"),
      u_gradeH: gl.getUniformLocation(this.program, "u_gradeH"),
      u_gradeBalance: gl.getUniformLocation(this.program, "u_gradeBalance"),
      u_bw: gl.getUniformLocation(this.program, "u_bw"),
      u_vigAmt: gl.getUniformLocation(this.program, "u_vigAmt"),
      u_vigMid: gl.getUniformLocation(this.program, "u_vigMid"),
      u_grain: gl.getUniformLocation(this.program, "u_grain"),
      u_sharpen: gl.getUniformLocation(this.program, "u_sharpen"),
      u_texel: gl.getUniformLocation(this.program, "u_texel"),
      u_nrLum: gl.getUniformLocation(this.program, "u_nrLum"),
      u_nrCol: gl.getUniformLocation(this.program, "u_nrCol"),
      u_maskCount: gl.getUniformLocation(this.program, "u_maskCount"),
      u_maskGeo: gl.getUniformLocation(this.program, "u_maskGeo"),
      u_maskAdj: gl.getUniformLocation(this.program, "u_maskAdj"),
      u_maskMeta: gl.getUniformLocation(this.program, "u_maskMeta"),
      u_maskRngA: gl.getUniformLocation(this.program, "u_maskRngA"),
      u_maskRngB: gl.getUniformLocation(this.program, "u_maskRngB"),
      u_brushPts: gl.getUniformLocation(this.program, "u_brushPts"),
      u_brushN: gl.getUniformLocation(this.program, "u_brushN"),
      u_rasterIdx: gl.getUniformLocation(this.program, "u_rasterIdx"),
      u_maskView: gl.getUniformLocation(this.program, "u_maskView"),
      u_exposure: gl.getUniformLocation(this.program, "u_exposure"),
      u_contrast: gl.getUniformLocation(this.program, "u_contrast"),
      u_highlights: gl.getUniformLocation(this.program, "u_highlights"),
      u_shadows: gl.getUniformLocation(this.program, "u_shadows"),
      u_whites: gl.getUniformLocation(this.program, "u_whites"),
      u_blacks: gl.getUniformLocation(this.program, "u_blacks"),
      u_temp: gl.getUniformLocation(this.program, "u_temp"),
      u_tint: gl.getUniformLocation(this.program, "u_tint"),
      u_saturation: gl.getUniformLocation(this.program, "u_saturation"),
      u_profSat: gl.getUniformLocation(this.program, "u_profSat"),
      u_vibrance: gl.getUniformLocation(this.program, "u_vibrance"),
      u_clarity: gl.getUniformLocation(this.program, "u_clarity"),
      u_dehaze: gl.getUniformLocation(this.program, "u_dehaze"),
      u_sharpenMask: gl.getUniformLocation(this.program, "u_sharpenMask"),
      u_texture: gl.getUniformLocation(this.program, "u_texture"),
      u_clip: gl.getUniformLocation(this.program, "u_clip"),
      u_calOn: gl.getUniformLocation(this.program, "u_calOn"),
      u_calR: gl.getUniformLocation(this.program, "u_calR"),
      u_calG: gl.getUniformLocation(this.program, "u_calG"),
      u_calB: gl.getUniformLocation(this.program, "u_calB"),
      u_detail: gl.getUniformLocation(this.program, "u_detail"),
      u_distort: gl.getUniformLocation(this.program, "u_distort"),
      u_lensABC: gl.getUniformLocation(this.program, "u_lensABC"),
      u_caR: gl.getUniformLocation(this.program, "u_caR"),
      u_caB: gl.getUniformLocation(this.program, "u_caB"),
      u_perspV: gl.getUniformLocation(this.program, "u_perspV"),
      u_perspH: gl.getUniformLocation(this.program, "u_perspH"),
      u_spotA: gl.getUniformLocation(this.program, "u_spotA"),
      u_spotB: gl.getUniformLocation(this.program, "u_spotB"),
      u_spotN: gl.getUniformLocation(this.program, "u_spotN"),
    };
  }

  /** Largest texture edge the GPU accepts (for capping 1:1 uploads). */
  maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  /**
   * WebKitGTK can silently grant a SMALLER GL backbuffer than the canvas
   * size we asked for — the canvas then CSS-stretches it and the "1:1"
   * preview comes out soft with no error anywhere. Detect the clamp, adopt
   * the granted size (so 1 canvas px = 1 buffer px again), and say so.
   */
  private adoptGrantedBackbuffer() {
    const gl = this.gl;
    const gw = gl.drawingBufferWidth;
    const gh = gl.drawingBufferHeight;
    if (gw >= this.canvas.width && gh >= this.canvas.height) return;
    // Preserve aspect when adopting the granted size — a one-axis clamp
    // would squash the photo (and read as "everything is misplaced").
    const k = Math.min(gw / this.canvas.width, gh / this.canvas.height);
    const aw = Math.max(1, Math.floor(this.canvas.width * k));
    const ah = Math.max(1, Math.floor(this.canvas.height * k));
    console.warn(
      `WebGL backbuffer clamped: asked ${this.canvas.width}x${this.canvas.height}, ` +
        `granted ${gw}x${gh} — adopting ${aw}x${ah}`
    );
    this.canvas.width = aw;
    this.canvas.height = ah;
  }

  /**
   * Upload (or clear) the raster mask weight map for mask slot `idx`.
   * Preview budget is one map (like the single previewed brush stroke);
   * exports render every raster mask CPU-side.
   */
  setRasterMask(img: HTMLImageElement | null, idx: number, key: string) {
    const gl = this.gl;
    this.rasterIdx = img ? idx : -1;
    this.rasterKey = img ? key : "";
    if (!img) return;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.rasterTex);
    // Maps are stored top-down; upload unflipped so v == top-down frame y.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Upload a decoded image as the working texture and size the canvas to it.
   * Accepts a canvas too (used to downscale 1:1 sources past the GPU cap). */
  setImage(img: HTMLImageElement | HTMLCanvasElement) {
    const gl = this.gl;
    this.imgW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
    this.imgH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
    this.reqW = this.imgW;
    this.reqH = this.imgH;
    this.canvas.width = this.imgW;
    this.canvas.height = this.imgH;
    this.adoptGrantedBackbuffer();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // images are top-down
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    this.hasImage = true;
  }

  /**
   * Apply the current edit params and draw. Cheap enough to call per frame.
   * With `fullFrame` (crop-tool mode) the crop window is ignored so the whole
   * straightened image is shown for the overlay to operate on.
   */
  render(p: EditParams, opts?: { fullFrame?: boolean; clip?: boolean; maskView?: number }) {
    if (!this.hasImage) return;
    const gl = this.gl;
    const u = this.uniforms;

    // --- Tone curve LUTs (profile base + parametric + master + RGB channels) ---
    const key = JSON.stringify([
      p.profile,
      p.toneCurve,
      p.toneCurveR,
      p.toneCurveG,
      p.toneCurveB,
      p.curveShadows,
      p.curveDarks,
      p.curveLights,
      p.curveHighlights,
    ]);
    if (key !== this.curveKey) {
      this.uploadLut(this.curveTex, 1, bakeCurveLuts(p), 256);
      this.curveKey = key;
    }

    // --- HSL mixer LUT ---
    const hslOn = !hslIsIdentity(p);
    if (hslOn) {
      const hslKey = JSON.stringify([p.hslHue, p.hslSat, p.hslLum]);
      if (hslKey !== this.hslKey) {
        this.uploadLut(this.hslTex, 2, bakeHslLut(p), 360);
        this.hslKey = hslKey;
      }
    }
    gl.uniform1f(this.uniforms.u_hslOn, hslOn ? 1 : 0);

    // --- Color grading uniforms ---
    gl.uniform3f(u.u_gradeS, p.gradeShadowHue / 360, p.gradeShadowSat / 100, p.gradeShadowLum / 100);
    gl.uniform3f(u.u_gradeM, p.gradeMidHue / 360, p.gradeMidSat / 100, p.gradeMidLum / 100);
    gl.uniform3f(u.u_gradeH, p.gradeHighHue / 360, p.gradeHighSat / 100, p.gradeHighLum / 100);
    gl.uniform1f(u.u_gradeBalance, p.gradeBalance / 100);
    const prof = profileLook(p.profile);
    gl.uniform1f(u.u_bw, p.blackWhite || prof.bw ? 1 : 0);
    gl.uniform1f(u.u_profSat, prof.sat);
    gl.uniform1f(u.u_vigAmt, p.vignetteAmount / 100);
    gl.uniform1f(u.u_vigMid, p.vignetteMidpoint / 100);
    gl.uniform1f(u.u_grain, p.grainAmount / 100);
    gl.uniform1f(u.u_sharpen, p.sharpenAmount / 100);
    gl.uniform2f(u.u_texel, 1 / Math.max(1, this.imgW), 1 / Math.max(1, this.imgH));
    gl.uniform1f(u.u_nrLum, p.noiseLuminance / 100);
    gl.uniform1f(u.u_nrCol, p.noiseColor / 100);

    // --- Local adjustment masks (max 4) ---
    const masks = p.masks.slice(0, 4);
    const geo = new Float32Array(16);
    const adj = new Float32Array(16);
    const meta = new Float32Array(16);
    const rngA = new Float32Array(16);
    const rngB = new Float32Array(16);
    masks.forEach((m, i) => {
      geo.set([m.x0, m.y0, m.x1, m.y1], i * 4);
      adj.set([m.exposure, m.contrast / 100, m.saturation / 100, m.temperature / 100], i * 4);
      const kindCode =
        m.kind === "global" ? 4 :
        m.kind === "raster" ? 3 : m.kind === "brush" ? 2 : m.kind === "radial" ? 1 : 0;
      meta.set([m.tint / 100, m.feather, m.invert ? 1 : 0, kindCode], i * 4);
      const rtype = m.rangeType === "luminance" ? 1 : m.rangeType === "color" ? 2 : 0;
      rngA.set([rtype, m.rangeLo, m.rangeHi, m.rangeSoft], i * 4);
      rngB.set([m.rangeHue / 360, m.rangeTol, (m.rotation * Math.PI) / 180, 0], i * 4);
    });
    gl.uniform1f(u.u_maskCount, masks.length);
    gl.uniform4fv(u.u_maskGeo, geo);
    gl.uniform4fv(u.u_maskAdj, adj);
    gl.uniform4fv(u.u_maskMeta, meta);
    gl.uniform4fv(u.u_maskRngA, rngA);
    gl.uniform4fv(u.u_maskRngB, rngB);

    // Brush stroke points (the preview supports one brush mask).
    const brush = masks.find((m) => m.kind === "brush");
    const pts = new Float32Array(48);
    const bn = Math.min(24, brush?.points.length ?? 0);
    for (let i = 0; i < bn; i++) {
      pts[i * 2] = brush!.points[i][0];
      pts[i * 2 + 1] = brush!.points[i][1];
    }
    gl.uniform2fv(u.u_brushPts, pts);
    gl.uniform1f(u.u_brushN, bn);
    gl.uniform1f(u.u_rasterIdx, this.rasterIdx);
    gl.uniform1f(u.u_maskView, opts?.maskView ?? -1);

    // --- Geometry ---
    const full = opts?.fullFrame === true;
    const crop = full
      ? { x: 0, y: 0, w: 1, h: 1 }
      : { x: p.cropX, y: p.cropY, w: p.cropW, h: p.cropH };
    const theta = (p.angle * Math.PI) / 180;
    const zoom = 1 / straightenScale(this.imgW, this.imgH, theta);

    // Output surface follows the crop so the displayed aspect is correct.
    const outW = Math.max(1, Math.round(this.imgW * crop.w));
    const outH = Math.max(1, Math.round(this.imgH * crop.h));
    if (this.reqW !== outW || this.reqH !== outH) {
      this.reqW = outW;
      this.reqH = outH;
      this.canvas.width = outW;
      this.canvas.height = outH;
      this.adoptGrantedBackbuffer();
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }

    gl.uniform4f(u.u_cropRect, crop.x, crop.y, crop.w, crop.h);
    gl.uniform1f(u.u_angle, theta);
    gl.uniform1f(u.u_zoom, zoom);
    gl.uniform1f(u.u_aspect, this.imgW / Math.max(1, this.imgH));
    gl.uniform1f(u.u_detail, Math.min(8, Math.max(1, 1 / Math.max(this.viewScale, 1e-3))));
    gl.uniform1f(u.u_distort, (p.distortion / 100) * 0.15);
    gl.uniform3f(u.u_lensABC, p.lensA, p.lensB, p.lensC);
    gl.uniform1f(u.u_caR, (p.caRed / 100) * 0.005);
    gl.uniform1f(u.u_caB, (p.caBlue / 100) * 0.005);
    gl.uniform1f(u.u_perspV, (p.perspV / 100) * 0.35);
    gl.uniform1f(u.u_perspH, (p.perspH / 100) * 0.35);

    // --- Heal/clone spots ---
    const spots = p.spots.slice(0, 8);
    const spotA = new Float32Array(32);
    const spotB = new Float32Array(32);
    spots.forEach((s, i) => {
      spotA.set([s.x, s.y, s.srcX, s.srcY], i * 4);
      spotB.set([s.radius, s.heal ? 1 : 0, s.feather, 0], i * 4);
    });
    gl.uniform4fv(u.u_spotA, spotA);
    gl.uniform4fv(u.u_spotB, spotB);
    gl.uniform1f(u.u_spotN, spots.length);

    // Map UI ranges (-100..100, or EV) into the shader's normalised space.
    gl.uniform1f(u.u_exposure, p.exposure);
    gl.uniform1f(u.u_contrast, p.contrast / 100);
    gl.uniform1f(u.u_highlights, p.highlights / 100);
    gl.uniform1f(u.u_shadows, p.shadows / 100);
    gl.uniform1f(u.u_whites, p.whites / 100);
    gl.uniform1f(u.u_blacks, p.blacks / 100);
    gl.uniform1f(u.u_temp, p.temperature / 100);
    gl.uniform1f(u.u_tint, p.tint / 100);
    gl.uniform1f(u.u_saturation, p.saturation / 100);
    gl.uniform1f(u.u_vibrance, p.vibrance / 100);
    gl.uniform1f(u.u_clarity, p.clarity / 100);
    gl.uniform1f(u.u_dehaze, p.dehaze / 100);
    gl.uniform1f(u.u_sharpenMask, p.sharpenMasking / 100);
    gl.uniform1f(u.u_texture, p.texture / 100);
    gl.uniform1f(u.u_clip, opts?.clip ? 1 : 0);

    // --- Calibration matrix ---
    const calOn = !calibrationIsIdentity(p);
    gl.uniform1f(u.u_calOn, calOn ? 1 : 0);
    if (calOn) {
      const [cr2, cg2, cb2] = calibrationMatrix(p);
      gl.uniform3f(u.u_calR, cr2[0], cr2[1], cr2[2]);
      gl.uniform3f(u.u_calG, cg2[0], cg2[1], cg2[2]);
      gl.uniform3f(u.u_calB, cb2[0], cb2[1], cb2[2]);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Read back the rendered frame and bin it into a 256-level RGB histogram.
   * Call right after `render()`. Pixels are sub-sampled (capped at ~120k) so
   * the GPU read-back stays cheap enough to run on every slider frame.
   */
  computeHistogram(): HistogramData | null {
    if (!this.hasImage) return null;
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

    const r = new Uint32Array(256);
    const g = new Uint32Array(256);
    const b = new Uint32Array(256);

    // Stride is a whole number of pixels (×4 bytes) to stay channel-aligned.
    const targetSamples = 120_000;
    const stride = 4 * Math.max(1, Math.floor((w * h) / targetSamples));
    for (let i = 0; i < px.length; i += stride) {
      r[px[i]]++;
      g[px[i + 1]]++;
      b[px[i + 2]]++;
    }
    return { r, g, b };
  }

  /** Upload a Wx1 RGB LUT to the given texture unit. */
  private uploadLut(tex: WebGLTexture | null, unit: number, lut: Uint8Array, width: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, lut);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose() {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.curveTex) gl.deleteTexture(this.curveTex);
    if (this.hslTex) gl.deleteTexture(this.hslTex);
    gl.deleteProgram(this.program);
    this.hasImage = false;
  }

  private buildProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const gl = this.gl;
    const vert = this.compile(gl.VERTEX_SHADER, vertSrc);
    const frag = this.compile(gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    if (!program) throw new Error("failed to create WebGL program");
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return program;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("failed to create shader");
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }
}
