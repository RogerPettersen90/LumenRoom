// Lens-profile corrections from the lensfun database (CC-BY-SA 3.0, the same
// data darktable/RawTherapee use). The interchangeable-lens XMLs (~3.5MB) are
// embedded in the binary and parsed lazily on first lookup. v1 scope:
// distortion (ptlens/poly3 → one cubic) + lateral TCA (vr/vb → CA sliders).
// Vignetting needs aperture/distance handling — later.

use include_dir::{include_dir, Dir};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::sync::OnceLock;

static DB_FILES: Dir = include_dir!("$CARGO_MANIFEST_DIR/lensfun");

/// One distortion calibration point. Coefficients in ptlens form:
/// Rd = Ru · (a·Ru³ + b·Ru² + c·Ru + d), d = 1 − a − b − c.
/// (poly3 entries are converted: a=0, b=k1, c=0.)
#[derive(Debug, Clone, Copy)]
pub struct DistCal {
    pub focal: f32,
    pub a: f32,
    pub b: f32,
    pub c: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct TcaCal {
    pub focal: f32,
    pub vr: f32,
    pub vb: f32,
}

#[derive(Debug, Clone)]
pub struct LensEntry {
    pub maker: String,
    pub model: String,
    pub crop_factor: f32,
    pub distortion: Vec<DistCal>,
    pub tca: Vec<TcaCal>,
}

/// A resolved profile for one lens at one focal length.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LensProfile {
    pub matched: String,
    /// Cubic distortion coefficients (ptlens form; d = 1−a−b−c).
    pub lens_a: f32,
    pub lens_b: f32,
    pub lens_c: f32,
    /// Suggested CA slider values (our −100..100 scale).
    pub ca_red: f32,
    pub ca_blue: f32,
}

fn db() -> &'static Vec<LensEntry> {
    static DB: OnceLock<Vec<LensEntry>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut out = Vec::new();
        for file in DB_FILES.files() {
            if let Ok(text) = std::str::from_utf8(file.contents()) {
                parse_file(text, &mut out);
            }
        }
        out
    })
}

fn parse_file(xml: &str, out: &mut Vec<LensEntry>) {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut cur: Option<LensEntry> = None;
    let mut text_target: Option<&'static str> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"lens" => {
                    cur = Some(LensEntry {
                        maker: String::new(),
                        model: String::new(),
                        crop_factor: 1.0,
                        distortion: Vec::new(),
                        tca: Vec::new(),
                    });
                }
                b"maker" => text_target = Some("maker"),
                b"model" => text_target = Some("model"),
                b"cropfactor" => text_target = Some("crop"),
                _ => text_target = None,
            },
            Ok(Event::Empty(e)) => {
                let Some(lens) = cur.as_mut() else { continue };
                let name = e.name();
                if name.as_ref() != b"distortion" && name.as_ref() != b"tca" {
                    continue;
                }
                let mut attrs: std::collections::HashMap<String, f32> = Default::default();
                let mut model_attr = String::new();
                for a in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(a.key.as_ref()).into_owned();
                    let val = String::from_utf8_lossy(&a.value).into_owned();
                    if key == "model" {
                        model_attr = val;
                    } else if let Ok(f) = val.parse::<f32>() {
                        attrs.insert(key, f);
                    }
                }
                let focal = attrs.get("focal").copied().unwrap_or(0.0);
                if name.as_ref() == b"distortion" {
                    match model_attr.as_str() {
                        "ptlens" => lens.distortion.push(DistCal {
                            focal,
                            a: attrs.get("a").copied().unwrap_or(0.0),
                            b: attrs.get("b").copied().unwrap_or(0.0),
                            c: attrs.get("c").copied().unwrap_or(0.0),
                        }),
                        "poly3" => lens.distortion.push(DistCal {
                            focal,
                            a: 0.0,
                            b: attrs.get("k1").copied().unwrap_or(0.0),
                            c: 0.0,
                        }),
                        _ => {} // poly5/acm — rare; skip in v1
                    }
                } else if model_attr == "poly3" {
                    lens.tca.push(TcaCal {
                        focal,
                        vr: attrs.get("vr").copied().unwrap_or(1.0),
                        vb: attrs.get("vb").copied().unwrap_or(1.0),
                    });
                }
            }
            Ok(Event::Text(t)) => {
                if let (Some(target), Some(lens)) = (text_target, cur.as_mut()) {
                    let txt = t.unescape().unwrap_or_default().into_owned();
                    match target {
                        "maker" => lens.maker = txt,
                        "model" => lens.model = txt,
                        "crop" => lens.crop_factor = txt.parse().unwrap_or(1.0),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                text_target = None;
                if e.name().as_ref() == b"lens" {
                    if let Some(lens) = cur.take() {
                        if !lens.model.is_empty() && !lens.distortion.is_empty() {
                            out.push(lens);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
}

/// Tokenize a lens name for matching: lowercase alphanumeric runs;
/// "f/2.8"-style apertures normalized ("f2.8"), mm markers kept.
fn tokens(s: &str) -> Vec<String> {
    s.to_lowercase()
        .replace("f/", "f")
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.')
        .filter(|t| !t.is_empty() && *t != "mm")
        .map(|t| t.trim_end_matches(".0").to_string())
        .collect()
}

/// Find the best database match for an EXIF lens string. Scores by token
/// overlap; requires most query tokens to appear. Among equal scores,
/// prefers the calibration done on the lowest crop factor (fullest frame).
pub fn match_lens(exif_lens: &str) -> Option<&'static LensEntry> {
    let q = tokens(exif_lens);
    if q.is_empty() {
        return None;
    }
    let mut best: Option<(f32, &LensEntry)> = None;
    for lens in db() {
        let m: Vec<String> = tokens(&format!("{} {}", lens.maker, lens.model));
        let hit = q.iter().filter(|t| m.contains(t)).count() as f32;
        let score = hit / q.len() as f32;
        if score < 0.6 {
            continue;
        }
        let better = match best {
            None => true,
            Some((bs, bl)) => {
                score > bs + 1e-6
                    || ((score - bs).abs() < 1e-6 && lens.crop_factor < bl.crop_factor)
            }
        };
        if better {
            best = Some((score, lens));
        }
    }
    best.map(|(_, l)| l)
}

/// Linear interpolation of the calibration at the shooting focal length.
fn interp_dist(cals: &[DistCal], focal: f32) -> (f32, f32, f32) {
    if cals.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let mut sorted: Vec<&DistCal> = cals.iter().collect();
    sorted.sort_by(|x, y| x.focal.partial_cmp(&y.focal).expect("focal NaN"));
    if focal <= sorted[0].focal {
        let c = sorted[0];
        return (c.a, c.b, c.c);
    }
    if focal >= sorted[sorted.len() - 1].focal {
        let c = sorted[sorted.len() - 1];
        return (c.a, c.b, c.c);
    }
    for w in sorted.windows(2) {
        if focal >= w[0].focal && focal <= w[1].focal {
            let t = (focal - w[0].focal) / (w[1].focal - w[0].focal).max(1e-6);
            return (
                w[0].a + t * (w[1].a - w[0].a),
                w[0].b + t * (w[1].b - w[0].b),
                w[0].c + t * (w[1].c - w[0].c),
            );
        }
    }
    (0.0, 0.0, 0.0)
}

fn interp_tca(cals: &[TcaCal], focal: f32) -> (f32, f32) {
    if cals.is_empty() {
        return (1.0, 1.0);
    }
    let mut sorted: Vec<&TcaCal> = cals.iter().collect();
    sorted.sort_by(|x, y| x.focal.partial_cmp(&y.focal).expect("focal NaN"));
    let lo = sorted[0];
    let hi = sorted[sorted.len() - 1];
    if focal <= lo.focal {
        return (lo.vr, lo.vb);
    }
    if focal >= hi.focal {
        return (hi.vr, hi.vb);
    }
    for w in sorted.windows(2) {
        if focal >= w[0].focal && focal <= w[1].focal {
            let t = (focal - w[0].focal) / (w[1].focal - w[0].focal).max(1e-6);
            return (
                w[0].vr + t * (w[1].vr - w[0].vr),
                w[0].vb + t * (w[1].vb - w[0].vb),
            );
        }
    }
    (1.0, 1.0)
}

/// Full lookup: EXIF lens string + shooting focal → resolved profile.
pub fn lookup(exif_lens: &str, focal: Option<f32>) -> Option<LensProfile> {
    let lens = match_lens(exif_lens)?;
    // No focal in EXIF → use the middle of the calibrated range.
    let f = focal.unwrap_or_else(|| {
        let mut fs: Vec<f32> = lens.distortion.iter().map(|c| c.focal).collect();
        fs.sort_by(|a, b| a.partial_cmp(b).expect("focal NaN"));
        fs[fs.len() / 2]
    });
    let (a, b, c) = interp_dist(&lens.distortion, f);
    let (vr, vb) = interp_tca(&lens.tca, f);
    Some(LensProfile {
        matched: format!("{} {} (f={:.0}mm)", lens.maker, lens.model, f),
        lens_a: a,
        lens_b: b,
        lens_c: c,
        // Our CA slider: ±100 → ±0.5% radial scale; vr/vb are scales ≈1.
        ca_red: ((vr - 1.0) / 0.005 * 100.0).clamp(-100.0, 100.0),
        ca_blue: ((vb - 1.0) / 0.005 * 100.0).clamp(-100.0, 100.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_parses_and_matches_a_sony_lens() {
        assert!(db().len() > 500, "expected hundreds of lenses, got {}", db().len());

        let lens = match_lens("Sony FE 24-70mm F4 ZA OSS").expect("should match");
        assert!(lens.model.contains("24-70"), "matched {}", lens.model);
        // Equal-score duplicates: the full-frame calibration wins.
        assert!(lens.crop_factor <= 1.01, "crop factor {}", lens.crop_factor);

        let p = lookup("Sony FE 24-70mm F4 ZA OSS", Some(24.0)).expect("profile");
        // At 24mm this zoom has clear barrel distortion (negative b).
        assert!(p.lens_b < -0.05, "expected barrel at 24mm, b={}", p.lens_b);

        // Interpolation between calibrated focals stays bounded.
        let mid = lookup("Sony FE 24-70mm F4 ZA OSS", Some(40.0)).expect("profile");
        assert!(mid.lens_b > p.lens_b && mid.lens_b < 0.05, "b@40={}", mid.lens_b);
    }

    #[test]
    fn unknown_lens_returns_none() {
        assert!(match_lens("Frobnicator 12-3400mm f/9.9").is_none());
    }
}
