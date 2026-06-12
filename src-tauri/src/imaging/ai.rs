// Local AI subject masking (ROADMAP v3 Phase C): U²-Net-p salient-object
// segmentation via tract — pure-Rust ONNX inference, so nothing dynamic to
// bundle and the AppImage stays self-contained. The 4.6MB model downloads on
// first use into the cache; everything runs offline afterwards.

use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};
use tract_onnx::prelude::*;

// Silueta: a 43MB U²-Net (same architecture as u2netp, so the tract compat
// patch applies unchanged) trained substantially better — chosen after the
// small model's mattes proved too loose in real-world use. Primary source is
// our own release mirror; upstream (rembg) is the fallback.
const MODEL_URLS: [&str; 2] = [
    "https://github.com/RogerPettersen90/LumenRoom/releases/download/v0.9.0-beta.1/silueta.onnx",
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx",
];
const MODEL_SIZE: u32 = 320; // the U²-Net family's fixed input resolution

/// Download the model on first use (atomic rename so a torn download never
/// poisons the cache). Returns the on-disk path.
pub fn ensure_model(models_dir: &Path) -> Result<PathBuf> {
    let path = models_dir.join("silueta.onnx");
    if path.exists() {
        return Ok(path);
    }
    std::fs::create_dir_all(models_dir)?;
    let tmp = models_dir.join("silueta.onnx.part");

    let mut bytes = Vec::new();
    let mut last_err = String::new();
    for url in MODEL_URLS {
        bytes.clear();
        match ureq::get(url).call() {
            Ok(resp) => {
                let mut reader = resp.into_body().into_reader();
                if std::io::copy(&mut reader, &mut bytes).is_ok() && !bytes.is_empty() {
                    break;
                }
                last_err = format!("truncated download from {url}");
            }
            Err(e) => last_err = format!("{url}: {e}"),
        }
    }
    if bytes.is_empty() {
        return Err(AppError::Msg(format!("model download failed: {last_err}")));
    }

    let patched = patch_resize_modes(&bytes)?;
    std::fs::write(&tmp, &patched)?;
    std::fs::rename(&tmp, &path)?;
    Ok(path)
}

/// Make u2net's ONNX graph tract-compatible. Two rewrites:
/// 1. Resize `coordinate_transformation_mode: pytorch_half_pixel` →
///    `half_pixel` (identical for every dim > 1, which u2net guarantees).
/// 2. Resize fed by `sizes` (with an empty `scales` placeholder) — tract
///    reads the empty scales and collapses the upsample to 1×. Synthesize
///    `scales = Cast_f32(sizes) / Cast_f32(Shape(X))` and feed the
///    scales form, which tract evaluates correctly.
fn patch_resize_modes(bytes: &[u8]) -> Result<Vec<u8>> {
    use prost::Message;
    use tract_onnx::pb::{attribute_proto, AttributeProto, NodeProto};

    let mut model = tract_onnx::pb::ModelProto::decode(bytes)
        .map_err(|e| AppError::Msg(format!("model parse: {e}")))?;
    let Some(graph) = model.graph.as_mut() else {
        return Err(AppError::Msg("model has no graph".into()));
    };

    let _ = attribute_proto::AttributeType::Int; // (kept import simple)
    let _: Option<NodeProto> = None;

    // Fix the unsupported coordinate mode FIRST — analysis must parse.
    for node in &mut graph.node {
        if node.op_type != "Resize" {
            continue;
        }
        for attr in &mut node.attribute {
            if attr.name == "coordinate_transformation_mode" && attr.s == b"pytorch_half_pixel" {
                attr.s = b"half_pixel".to_vec();
            }
        }
    }
    let mut mode_fixed = Vec::with_capacity(bytes.len());
    model
        .encode(&mut mode_fixed)
        .map_err(|e| AppError::Msg(format!("model re-encode: {e}")))?;

    // Pass 1 — tract's own shape analysis tells us every Resize's true
    // input/output dims at the fixed 320×320 working size.
    let scales_by_node = resize_scales_via_analysis(&mode_fixed)?;
    let graph = model.graph.as_mut().expect("graph checked above");

    // Pass 2 — bake those as constant `scales` initializers.
    for node in &mut graph.node {
        if node.op_type != "Resize" {
            continue;
        }
        if let Some(scales) = scales_by_node.get(&node.name) {
            let tensor_name = format!("{}_tract_scales", node.name);
            graph.initializer.push(tract_onnx::pb::TensorProto {
                name: tensor_name.clone(),
                data_type: 1, // FLOAT
                dims: vec![4],
                float_data: scales.to_vec(),
                ..Default::default()
            });
            let roi = node.input.get(1).cloned().unwrap_or_default();
            node.input = vec![node.input[0].clone(), roi, tensor_name];
        }
    }

    let mut out = Vec::with_capacity(bytes.len());
    model
        .encode(&mut out)
        .map_err(|e| AppError::Msg(format!("model re-encode: {e}")))?;
    Ok(out)
}

/// Pass 1 of the tract-compat patch: parse the unmodified model, pin the
/// input to 1×3×320×320, run tract's shape analysis, and read off each
/// Resize node's concrete input/output dims → per-axis scale factors.
fn resize_scales_via_analysis(
    bytes: &[u8],
) -> Result<std::collections::HashMap<String, [f32; 4]>> {
    let mut m = tract_onnx::onnx()
        .model_for_read(&mut std::io::Cursor::new(bytes))
        .map_err(|e| AppError::Msg(format!("analysis parse: {e}")))?;
    m.set_input_fact(
        0,
        InferenceFact::dt_shape(
            f32::datum_type(),
            tvec!(1, 3, MODEL_SIZE as usize, MODEL_SIZE as usize),
        ),
    )
    .map_err(|e| AppError::Msg(format!("analysis fact: {e}")))?;
    m.analyse(false)
        .map_err(|e| AppError::Msg(format!("analysis: {e}")))?;

    let concrete = |fact: &InferenceFact| -> Option<Vec<usize>> {
        fact.shape
            .as_concrete_finite()
            .ok()
            .flatten()
            .map(|d| d.to_vec())
    };

    let mut out = std::collections::HashMap::new();
    for node in m.nodes() {
        // The ONNX node name survives as a prefix of the tract node name.
        let Some(raw) = node.name.split('.').next() else { continue };
        if !raw.starts_with("Resize") {
            continue;
        }
        let in_fact = m.outlet_fact(node.inputs[0]).ok();
        let out_fact = node.outputs.first().map(|o| &o.fact);
        let (Some(i), Some(o)) = (
            in_fact.and_then(|f| concrete(f)),
            out_fact.and_then(|f| concrete(f)),
        ) else {
            continue;
        };
        if i.len() != 4 || o.len() != 4 {
            continue;
        }
        let mut scales = [1f32; 4];
        for k in 0..4 {
            scales[k] = o[k] as f32 / i[k].max(1) as f32;
        }
        out.insert(raw.to_string(), scales);
    }
    Ok(out)
}

type Plan = SimplePlan<TypedFact, Box<dyn TypedOp>, TypedModel>;
static PLAN: std::sync::OnceLock<Plan> = std::sync::OnceLock::new();

fn load_plan(model_path: &Path) -> Result<Plan> {
    tract_onnx::onnx()
        .model_for_path(model_path)
        .map_err(|e| AppError::Msg(format!("model load: {e}")))?
        .with_input_fact(
            0,
            InferenceFact::dt_shape(
                f32::datum_type(),
                tvec!(1, 3, MODEL_SIZE as usize, MODEL_SIZE as usize),
            ),
        )
        .map_err(|e| AppError::Msg(format!("model fact: {e}")))?
        // into_typed (shape analysis + declutter), NOT into_optimized: the
        // full optimizer mis-folds u2net's dynamic Resize sizes (collapses
        // the 2× decoder upsamples to 1×), and the raw inference graph can't
        // evaluate the Shape→Concat subgraphs. One-shot mask generation
        // doesn't need codegen speed anyway.
        .into_typed()
        .map_err(|e| AppError::Msg(format!("model typing: {e}")))?
        .into_runnable()
        .map_err(|e| AppError::Msg(format!("model plan: {e}")))
}

/// Run salient-subject segmentation over an RGB image; returns a grayscale
/// weight map at the input's resolution (white = subject). The compiled
/// plan is cached after the first call.
pub fn subject_mask(img: &image::RgbImage, model_path: &Path) -> Result<image::GrayImage> {
    if PLAN.get().is_none() {
        let plan = load_plan(model_path)?;
        let _ = PLAN.set(plan);
    }
    let model = PLAN.get().expect("plan just initialized");

    // Letterbox-free squash to 320×320, ImageNet-style normalization (what
    // u2net was trained with via rembg).
    let small = image::imageops::resize(
        img,
        MODEL_SIZE,
        MODEL_SIZE,
        image::imageops::FilterType::Triangle,
    );
    const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
    const STD: [f32; 3] = [0.229, 0.224, 0.225];
    let input = tract_ndarray::Array4::from_shape_fn(
        (1, 3, MODEL_SIZE as usize, MODEL_SIZE as usize),
        |(_, c, y, x)| {
            let v = small.get_pixel(x as u32, y as u32).0[c] as f32 / 255.0;
            (v - MEAN[c]) / STD[c]
        },
    );

    let outputs = model
        .run(tvec!(Tensor::from(input).into()))
        .map_err(|e| AppError::Msg(format!("inference: {e}")))?;
    // u2netp's first output is the fused saliency map (1×1×320×320).
    let sal = outputs[0]
        .to_array_view::<f32>()
        .map_err(|e| AppError::Msg(format!("output: {e}")))?;

    // Min-max normalize (u2net convention), then upscale to the source size.
    let vals: Vec<f32> = sal.iter().copied().collect();
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for &v in &vals {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    let range = (hi - lo).max(1e-6);
    let mut map = image::GrayImage::new(MODEL_SIZE, MODEL_SIZE);
    for (i, px) in map.pixels_mut().enumerate() {
        let n = (vals[i] - lo) / range;
        px.0[0] = (n * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    Ok(image::imageops::resize(
        &map,
        img.width(),
        img.height(),
        image::imageops::FilterType::Triangle,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real model download + inference. Run with:
    ///   cargo test --lib subject_mask_runs -- --ignored --nocapture
    #[test]
    #[ignore]
    fn subject_mask_runs_end_to_end() {
        let dir = std::env::temp_dir().join("lumen-ai-test");
        let model = ensure_model(&dir).expect("model download");

        // Bright centered "subject" on a dark background.
        let mut img = image::RgbImage::from_pixel(640, 480, image::Rgb([18, 22, 30]));
        for y in 140..340 {
            for x in 220..420 {
                img.put_pixel(x, y, image::Rgb([220, 190, 160]));
            }
        }
        let t0 = std::time::Instant::now();
        let map = subject_mask(&img, &model).expect("inference");
        println!("inference took {:?}", t0.elapsed());

        assert_eq!((map.width(), map.height()), (640, 480));
        let center = map.get_pixel(320, 240).0[0];
        let corner = map.get_pixel(8, 8).0[0];
        println!("center={center} corner={corner}");
        assert!(center > corner, "subject should out-score background");
    }
}

#[cfg(test)]
mod real_photo_probe {
    use super::*;

    #[test]
    #[ignore]
    fn subject_mask_on_real_dng() {
        let model = ensure_model(&std::env::temp_dir().join("lumen-ai-test")).unwrap();
        let img = crate::imaging::raw::decode_embedded_preview(std::path::Path::new(
            "../sample_raw/sample.dng",
        ))
        .unwrap()
        .to_rgb8();
        let img = image::imageops::resize(&img, 768, 512, image::imageops::FilterType::Triangle);
        let map = subject_mask(&img, &model).unwrap();
        map.save("/tmp/subject_real.png").unwrap();
        // Coverage stats: how much of the frame is "subject"?
        let n = (map.width() * map.height()) as f32;
        let on = map.pixels().filter(|p| p.0[0] > 128).count() as f32;
        let mean: f32 = map.pixels().map(|p| p.0[0] as f32).sum::<f32>() / n;
        println!("subject coverage: {:.1}% above-half, mean={:.0}", on / n * 100.0, mean);
    }
}

/// Edge-aware mask refinement: joint bilateral filter of the (coarse, 320px-
/// upscaled) saliency map guided by the photo itself, plus a gentle contrast
/// snap. Mask edges lock onto real image edges instead of the model's blobby
/// outline — the practical accuracy fix without a bigger model.
pub fn refine_mask(mask: &image::GrayImage, guide: &image::RgbImage) -> image::GrayImage {
    use rayon::prelude::*;
    let (w, h) = mask.dimensions();
    if guide.dimensions() != (w, h) {
        return mask.clone();
    }
    const R: i32 = 6;
    const SIG_C2: f32 = 2.0 * 0.12 * 0.12; // color similarity sigma
    const SIG_S2: f32 = 2.0 * 3.0 * 3.0; // spatial sigma (px)

    let lum = |x: u32, y: u32| -> f32 {
        let p = guide.get_pixel(x, y).0;
        (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0
    };

    let mut out = image::GrayImage::new(w, h);
    out.enumerate_rows_mut().par_bridge().for_each(|(y, row)| {
        for (x, _, px) in row {
            let lc = lum(x, y);
            let mut acc = 0f32;
            let mut wsum = 0f32;
            for dy in -R..=R {
                let yy = y as i32 + dy;
                if yy < 0 || yy >= h as i32 {
                    continue;
                }
                for dx in -R..=R {
                    let xx = x as i32 + dx;
                    if xx < 0 || xx >= w as i32 {
                        continue;
                    }
                    let dl = lum(xx as u32, yy as u32) - lc;
                    let ws = (-((dx * dx + dy * dy) as f32) / SIG_S2).exp();
                    let wc = (-(dl * dl) / SIG_C2).exp();
                    let wgt = ws * wc;
                    acc += wgt * mask.get_pixel(xx as u32, yy as u32).0[0] as f32;
                    wsum += wgt;
                }
            }
            let v = (acc / wsum.max(1e-6)) / 255.0;
            // Firm matte: a steep smoothstep kills the halo band the model's
            // soft 320px boundary leaves after upscaling, while the bilateral
            // pass above has already aligned the edge to the image.
            let t = ((v - 0.35) / 0.30).clamp(0.0, 1.0);
            let snapped = t * t * (3.0 - 2.0 * t);
            px.0[0] = (snapped * 255.0).round() as u8;
        }
    });
    out
}

#[cfg(test)]
mod refine_tests {
    use super::*;

    #[test]
    fn refinement_snaps_mask_edge_to_image_edge() {
        // Guide: hard edge at x=50. Mask: soft edge offset to x=44.
        let w = 100u32;
        let h = 40u32;
        let mut guide = image::RgbImage::new(w, h);
        for (x, _y, p) in guide.enumerate_pixels_mut() {
            let v = if x < 50 { 30 } else { 220 };
            *p = image::Rgb([v, v, v]);
        }
        let mut mask = image::GrayImage::new(w, h);
        for (x, _y, p) in mask.enumerate_pixels_mut() {
            let t = ((x as f32 - 44.0) / 8.0).clamp(0.0, 1.0);
            p.0[0] = (t * 255.0) as u8;
        }

        let refined = refine_mask(&mask, &guide);
        let left = refined.get_pixel(47, 20).0[0];
        let right = refined.get_pixel(53, 20).0[0];
        assert!(
            right as i32 - left as i32 > 80,
            "edge should snap to x=50: left={left} right={right}"
        );
        let raw_left = mask.get_pixel(47, 20).0[0];
        assert!(left < raw_left, "dark side should firm up: {left} vs raw {raw_left}");
    }
}

#[cfg(test)]
mod alignment_probe {
    use super::*;

    fn centroid(map: &image::GrayImage) -> (f32, f32) {
        let (mut sx, mut sy, mut sw) = (0f64, 0f64, 0f64);
        for (x, y, p) in map.enumerate_pixels() {
            let w = p.0[0] as f64;
            sx += x as f64 * w;
            sy += y as f64 * w;
            sw += w;
        }
        ((sx / sw) as f32, (sy / sw) as f32)
    }

    #[test]
    #[ignore]
    fn measure_mask_alignment_bias() {
        let model = ensure_model(&std::env::temp_dir().join("lumen-ai-test")).unwrap();
        // Square dead-center: centroid of the mask should be dead-center too.
        let mut img = image::RgbImage::from_pixel(960, 640, image::Rgb([20, 24, 30]));
        for y in 220..420 {
            for x in 380..580 {
                img.put_pixel(x, y, image::Rgb([225, 200, 170]));
            }
        }
        let map = subject_mask(&img, &model).unwrap();
        let (cx, cy) = centroid(&map);
        println!(
            "true center=(480,320) mask centroid=({cx:.1},{cy:.1}) bias=({:+.1},{:+.1})",
            cx - 480.0,
            cy - 320.0
        );
        // Off-center square too (bias might be position-dependent).
        let mut img2 = image::RgbImage::from_pixel(960, 640, image::Rgb([20, 24, 30]));
        for y in 80..240 {
            for x in 120..280 {
                img2.put_pixel(x, y, image::Rgb([225, 200, 170]));
            }
        }
        let map2 = subject_mask(&img2, &model).unwrap();
        let (cx2, cy2) = centroid(&map2);
        println!(
            "true center=(200,160) mask centroid=({cx2:.1},{cy2:.1}) bias=({:+.1},{:+.1})",
            cx2 - 200.0,
            cy2 - 160.0
        );
    }
}
