//! Effet « livraison » (Windows) : l'orbe lance une comète vers le texte qu'on vient de
//! coller, et ce texte s'illumine en violet, ligne par ligne, avant de s'effacer.
//!
//! Zéro latence ajoutée au collage :
//!  - tout tourne sur des fils à part ; `paste_text` ne fait que les lancer (quelques µs) ;
//!  - la sonde du curseur (caret.rs) s'exécute PENDANT la pause de stabilisation qui
//!    précède déjà Ctrl+V ;
//!  - la comète part au moment exact où Ctrl+V est envoyé (signal `Go`).
//!
//! Rendu : une fenêtre superposée native (WS_EX_LAYERED), clic-traversante, qui ne prend
//! jamais le focus, redimensionnée à chaque image à la seule zone dessinée ; les pixels
//! sont calculés par tiny-skia (anti-crénelage) et présentés par UpdateLayeredWindow au
//! rythme du compositeur (DwmFlush). Aucune webview, aucun coût au repos : la fenêtre
//! n'existe que le temps de l'effet (~1,5 s).

use crate::caret::{self, Probe};
use crate::delivery::{
    approx_lines, caret_moved, clamp01, ease_in_out_cubic, ease_out_cubic, extend_to_caret,
    flight_ms, revealed, sanitize_lines, sweep_ms, text_length, Flight, Rect,
};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tiny_skia::{
    Color, FillRule, GradientStop, LinearGradient, Paint, Path, PathBuilder, Pixmap, Point,
    RadialGradient, Shader, SpreadMode, Stroke, Transform,
};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Dwm::DwmFlush;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowRect,
    IsWindowVisible, PeekMessageW, RegisterClassExW, ShowWindow, TranslateMessage,
    UpdateLayeredWindow, HTTRANSPARENT, MSG, PM_REMOVE, SW_SHOWNOACTIVATE, ULW_ALPHA, WM_NCHITTEST,
    WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

/// Event vers l'orbe : direction du lancer (miroir de ORB_LAUNCH_EVENT côté TypeScript).
const ORB_LAUNCH_EVENT: &str = "orb-launch";
/// Rayon du cœur de l'orbe, en fraction du côté de sa fenêtre (miroir de coreRatio).
const ORB_CORE_RATIO: f32 = 0.165;

/// Trace de diagnostic (builds de développement uniquement).
macro_rules! fx_log {
    ($($t:tt)*) => {
        #[cfg(debug_assertions)]
        eprintln!("[fx] {}", format!($($t)*));
    };
}

/// Une livraison plus récente interrompt la précédente.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct OrbLaunch {
    dx: f32,
    dy: f32,
}

/// D'où partent la comète et le texte à illuminer.
enum Source {
    /// Collage réel : on sonde l'application cible.
    Paste { target: isize, chars: usize },
    /// Aperçu (Réglages) : lignes déjà connues.
    Preview(Vec<Rect>),
}

/// Messages de la sonde vers le fil de rendu.
enum Found {
    /// Caret AVANT collage (début du texte).
    Pre(Option<Rect>),
    /// Lignes du texte collé (vide : inconnues) + caret de fin.
    Lines(Vec<Rect>, Option<Rect>),
}

/// Déclencheur renvoyé à `paste_text` : à appeler juste après l'envoi de Ctrl+V.
/// Abandonné sans appel (collage échoué) = l'effet s'annule.
pub struct Launch(Sender<()>);

impl Launch {
    pub fn go(self) {
        let _ = self.0.send(());
    }
}

/// Prépare l'effet pour un collage dans `target` (HWND) de `chars` caractères. Retour
/// immédiat : la sonde démarre en parallèle de la pause qui précède Ctrl+V.
/// None si Windows a désactivé les animations (Accessibilité › Effets d'animation).
pub fn prepare(app: &AppHandle, orb: Option<isize>, target: isize, chars: usize) -> Option<Launch> {
    system_animations_enabled().then(|| start(app, orb, Source::Paste { target, chars }))
}

/// Réglage Windows « Effets d'animation » (vrai si on ne peut pas le lire).
fn system_animations_enabled() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION,
    };
    let mut enabled: i32 = 1;
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            &mut enabled as *mut i32 as *mut core::ffi::c_void,
            0,
        )
    };
    ok == 0 || enabled != 0
}

/// Aperçu : comète de l'orbe vers des lignes données (pixels physiques), tout de suite.
pub fn preview(app: &AppHandle, orb: Option<isize>, lines: Vec<Rect>) {
    start(app, orb, Source::Preview(lines)).go();
}

fn start(app: &AppHandle, orb: Option<isize>, source: Source) -> Launch {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let (go_tx, go_rx) = mpsc::channel();
    let (found_tx, found_rx) = mpsc::channel();
    let t0 = Instant::now();
    match source {
        Source::Preview(lines) => {
            let first = lines.first().map(|l| Rect::new(l.x, l.y, 2.0, l.h));
            let _ = found_tx.send(Found::Pre(first));
            let _ = found_tx.send(Found::Lines(lines, None));
        }
        Source::Paste { target, chars } => {
            std::thread::spawn(move || probe(target, chars, t0, found_tx));
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        // Attend Ctrl+V (ou l'abandon du collage).
        if go_rx.recv_timeout(Duration::from_millis(3000)).is_err() {
            return;
        }
        run(&app, orb, generation, found_rx);
    });
    Launch(go_tx)
}

/// Fil de sonde : caret avant collage, puis texte collé (avec quelques relances le temps
/// que l'application traite Ctrl+V).
fn probe(target: isize, chars: usize, t0: Instant, tx: Sender<Found>) {
    let probe = Probe::new();
    let pre = probe.caret(target);
    fx_log!("sonde : caret avant collage {pre:?}");
    if tx.send(Found::Pre(pre)).is_err() {
        return;
    }
    let bounds = caret::window_bounds(target);
    let scale = 1.0;
    // Ctrl+V part ~60 ms après t0 ; l'application le traite dans la foulée.
    let first_try = Duration::from_millis(150);
    if let Some(wait) = first_try.checked_sub(t0.elapsed()) {
        std::thread::sleep(wait);
    }
    for _ in 0..5 {
        if let Some((rects, end)) = probe.inserted_text(target, chars) {
            if pre.is_none_or(|p| caret_moved(&p, &end)) {
                let mut lines = sanitize_lines(&rects, bounds, scale);
                extend_to_caret(&mut lines, &end);
                fx_log!(
                    "sonde : {} ligne(s) via UI Automation, fin {end:?}",
                    lines.len()
                );
                let _ = tx.send(Found::Lines(lines, Some(end)));
                return;
            }
        } else if let (Some(p), Some(post)) = (pre, probe.caret(target)) {
            if caret_moved(&p, &post) {
                let field = probe.field_bounds(target);
                let lines = sanitize_lines(&approx_lines(&p, &post, field.as_ref()), bounds, scale);
                fx_log!(
                    "sonde : {} ligne(s) estimées (caret {post:?}, champ {field:?})",
                    lines.len()
                );
                let _ = tx.send(Found::Lines(lines, Some(post)));
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(90));
    }
    fx_log!("sonde : texte collé introuvable");
    let _ = tx.send(Found::Lines(Vec::new(), None));
}

// ------------------------------------------------------------------ chronologie

const SPLASH_MS: f32 = 460.0;
const HOLD_MS: f32 = 260.0;
const FADE_MS: f32 = 720.0;
/// Sans destination connue à ce stade, on renonce (rien à montrer).
const GIVE_UP_MS: f32 = 900.0;
/// Délai max, après l'impact, pour que les lignes du texte arrivent.
const LINES_GRACE_MS: f32 = 600.0;

struct Scene {
    scale: f32,
    origin: Option<(f32, f32, f32)>, // centre + rayon du cœur de l'orbe
    pre: Option<Rect>,
    lines: Option<Vec<Rect>>,
    end: Option<Rect>,
    flight: Option<(Flight, f32, f32)>, // trajectoire, début (ms), durée (ms)
    land: Option<(f32, (f32, f32), f32)>, // instant, point, hauteur de ligne
    sweep_at: Option<f32>,
}

fn run(app: &AppHandle, orb: Option<isize>, generation: u64, found: Receiver<Found>) {
    let origin_info = orb.and_then(orb_origin);
    let scale = origin_info.map(|o| o.3).unwrap_or(1.0);
    let mut scene = Scene {
        scale,
        origin: origin_info.map(|o| (o.0, o.1, o.2)),
        pre: None,
        lines: None,
        end: None,
        flight: None,
        land: None,
        sweep_at: None,
    };
    fx_log!("départ : orbe {:?}, échelle {scale}", scene.origin);
    let Some(mut surface) = Surface::new() else {
        fx_log!("fenêtre superposée impossible à créer");
        return;
    };
    let t0 = Instant::now();
    let mut pre_received = false;

    loop {
        if GENERATION.load(Ordering::SeqCst) != generation {
            break;
        }
        let now = t0.elapsed().as_secs_f32() * 1000.0;

        // ---- Nouvelles de la sonde (on attend brièvement le caret de départ) ----
        loop {
            let msg = if !pre_received && now < 120.0 {
                match found.recv_timeout(Duration::from_millis(4)) {
                    Ok(m) => Some(m),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => None,
                }
            } else {
                found.try_recv().ok()
            };
            match msg {
                Some(Found::Pre(p)) => {
                    pre_received = true;
                    scene.pre = p;
                }
                Some(Found::Lines(lines, end)) => {
                    scene.lines = Some(lines);
                    scene.end = end;
                }
                None => break,
            }
        }

        // ---- Lancement ----
        if scene.flight.is_none() && scene.land.is_none() {
            if let Some((dest, line_h)) = destination(&scene) {
                match scene.origin {
                    Some((cx, cy, r0)) => {
                        let (dx, dy) = (dest.0 - cx, dest.1 - cy);
                        let d = (dx * dx + dy * dy).sqrt().max(1.0);
                        let (ux, uy) = (dx / d, dy / d);
                        let start = (cx + ux * r0 * 1.02, cy + uy * r0 * 1.02);
                        let flight = Flight::new(start, dest);
                        let ms = flight_ms(flight.length(), scene.scale);
                        fx_log!("vol {:?} → {:?} en {ms:.0} ms", flight.s, flight.e);
                        scene.flight = Some((flight, now, ms));
                        let _ = app.emit_to(
                            crate::orb::ORB_LABEL,
                            ORB_LAUNCH_EVENT,
                            OrbLaunch { dx: ux, dy: uy },
                        );
                    }
                    None => scene.land = Some((now, dest, line_h)),
                }
            } else if now > GIVE_UP_MS {
                break;
            }
        }

        // ---- Vol : cap corrigé en douceur si le texte réel est ailleurs ----
        if let Some((flight, t_start, ms)) = scene.flight.as_mut() {
            if let Some(first) = scene.lines.as_ref().and_then(|l| l.first()) {
                let target = (first.x, first.cy());
                flight.e.0 += (target.0 - flight.e.0) * 0.35;
                flight.e.1 += (target.1 - flight.e.1) * 0.35;
            }
            if now - *t_start >= *ms {
                let h = scene
                    .lines
                    .as_ref()
                    .and_then(|l| l.first().map(|r| r.h))
                    .or(scene.pre.map(|p| p.h))
                    .unwrap_or(20.0 * scene.scale);
                scene.land = Some((now, flight.e, h));
                scene.flight = None;
            }
        }

        // ---- Balayage dès que l'impact a eu lieu ET que les lignes sont connues ----
        if let Some((t_land, _, _)) = scene.land {
            if scene.sweep_at.is_none() {
                match scene.lines.as_ref() {
                    Some(l) if !l.is_empty() => scene.sweep_at = Some(now.max(t_land)),
                    _ => {}
                }
            }
            let splash_over = now - t_land > SPLASH_MS;
            let highlight_over = match (scene.sweep_at, scene.lines.as_ref()) {
                (Some(t), Some(l)) => now - t > sweep_ms(l.len()) + HOLD_MS + FADE_MS,
                (None, Some(l)) if l.is_empty() => true,
                (None, _) => now - t_land > LINES_GRACE_MS,
                _ => true,
            };
            if splash_over && highlight_over {
                break;
            }
        }

        // ---- Image ----
        if !surface.draw(&scene, now) {
            break;
        }
        surface.pump();
        if unsafe { DwmFlush() } < 0 {
            std::thread::sleep(Duration::from_millis(8));
        }
        if now > 6000.0 {
            break; // garde-fou absolu
        }
    }
    fx_log!("fin ({:.0} ms)", t0.elapsed().as_secs_f32() * 1000.0);
    surface.destroy();
}

/// Où la comète doit se poser : début du texte (lignes connues), sinon caret de départ,
/// sinon caret de fin.
fn destination(scene: &Scene) -> Option<((f32, f32), f32)> {
    if let Some(first) = scene.lines.as_ref().and_then(|l| l.first()) {
        return Some(((first.x, first.cy()), first.h));
    }
    if let Some(p) = scene.pre {
        return Some(((p.x, p.cy()), p.h));
    }
    if scene.lines.is_some() {
        if let Some(e) = scene.end {
            return Some(((e.x, e.cy()), e.h));
        }
    }
    None
}

/// Centre (px physiques), rayon du cœur et échelle DPI de l'orbe, si elle est affichée.
fn orb_origin(hwnd: isize) -> Option<(f32, f32, f32, f32)> {
    let hwnd = hwnd as HWND;
    unsafe {
        if hwnd.is_null() || IsWindowVisible(hwnd) == 0 {
            return None;
        }
        let mut rc = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut rc) == 0 {
            return None;
        }
        let side = (rc.right - rc.left).max(1) as f32;
        let dpi = GetDpiForWindow(hwnd);
        let scale = if dpi > 0 { dpi as f32 / 96.0 } else { 1.0 };
        Some((
            rc.left as f32 + side / 2.0,
            rc.top as f32 + side / 2.0,
            side * ORB_CORE_RATIO,
            scale,
        ))
    }
}

// ------------------------------------------------------------------ dessin

fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color::from_rgba8(r, g, b, (clamp01(a) * 255.0).round() as u8)
}

fn solid(color: Color) -> Paint<'static> {
    shaded(Shader::SolidColor(color))
}

fn shaded(shader: Shader<'static>) -> Paint<'static> {
    Paint {
        shader,
        anti_alias: true,
        ..Default::default()
    }
}

fn circle(x: f32, y: f32, r: f32) -> Option<Path> {
    PathBuilder::from_circle(x, y, r.max(0.1))
}

fn round_rect(r: &Rect, radius: f32) -> Option<Path> {
    let mut pb = PathBuilder::new();
    push_round_rect(&mut pb, r, radius);
    pb.finish()
}

/// Ajoute un rectangle arrondi au tracé. Plusieurs rectangles dans UN tracé (même sens,
/// règle non nulle) = leur union : deux lignes qui se touchent ne se superposent pas.
fn push_round_rect(pb: &mut PathBuilder, r: &Rect, radius: f32) {
    if r.w <= 0.0 || r.h <= 0.0 {
        return;
    }
    let rad = radius.min(r.w / 2.0).min(r.h / 2.0).max(0.0);
    let k = 0.552_284_8 * rad;
    let (x, y, w, h) = (r.x, r.y, r.w, r.h);
    pb.move_to(x + rad, y);
    pb.line_to(x + w - rad, y);
    pb.cubic_to(x + w - rad + k, y, x + w, y + rad - k, x + w, y + rad);
    pb.line_to(x + w, y + h - rad);
    pb.cubic_to(
        x + w,
        y + h - rad + k,
        x + w - rad + k,
        y + h,
        x + w - rad,
        y + h,
    );
    pb.line_to(x + rad, y + h);
    pb.cubic_to(x + rad - k, y + h, x, y + h - rad + k, x, y + h - rad);
    pb.line_to(x, y + rad);
    pb.cubic_to(x, y + rad - k, x + rad - k, y, x + rad, y);
    pb.close();
}

/// Remplit l'union de plusieurs rectangles arrondis d'une seule couleur.
fn fill_union(pm: &mut Pixmap, rects: &[Rect], radius: f32, color: Color, tf: Transform) {
    let mut pb = PathBuilder::new();
    for r in rects {
        push_round_rect(&mut pb, r, radius);
    }
    if let Some(path) = pb.finish() {
        pm.fill_path(&path, &solid(color), FillRule::Winding, tf, None);
    }
}

fn radial(x: f32, y: f32, r: f32, stops: &[(f32, Color)]) -> Option<Shader<'static>> {
    RadialGradient::new(
        Point::from_xy(x, y),
        Point::from_xy(x, y),
        r.max(0.5),
        stops
            .iter()
            .map(|(p, c)| GradientStop::new(*p, *c))
            .collect(),
        SpreadMode::Pad,
        Transform::identity(),
    )
}

fn linear(a: (f32, f32), b: (f32, f32), stops: &[(f32, Color)]) -> Option<Shader<'static>> {
    LinearGradient::new(
        Point::from_xy(a.0, a.1),
        Point::from_xy(b.0, b.1),
        stops
            .iter()
            .map(|(p, c)| GradientStop::new(*p, *c))
            .collect(),
        SpreadMode::Pad,
        Transform::identity(),
    )
}

/// Petit hasard déterministe (étincelles reproductibles).
fn hash(n: u32) -> f32 {
    let mut x = n.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 15;
    x = x.wrapping_mul(0x2C1B_3C6D);
    x ^= x >> 12;
    (x & 0xFFFF) as f32 / 65535.0
}

/// Ce qu'on dessine à l'instant `now` : primitives en coordonnées écran + leur emprise.
struct Frame {
    bounds: Option<Rect>,
}

impl Frame {
    fn include(&mut self, r: Rect) {
        self.bounds = Some(match self.bounds {
            Some(b) => b.union(&r),
            None => r,
        });
    }
}

/// Emprise de la scène (pour dimensionner la fenêtre à la seule zone dessinée).
fn scene_bounds(scene: &Scene, now: f32) -> Option<Rect> {
    let s = scene.scale;
    let mut f = Frame { bounds: None };
    if let Some((flight, t_start, ms)) = scene.flight {
        let p = clamp01((now - t_start) / ms);
        for k in 0..=6 {
            let u = ease_in_out_cubic((p - k as f32 * 0.03).max(0.0));
            let (x, y) = flight.point(u);
            f.include(Rect::new(x, y, 0.0, 0.0).inflate(40.0 * s, 40.0 * s));
        }
    }
    if let Some((_, (x, y), h)) = scene.land {
        f.include(Rect::new(x, y, 0.0, 0.0).inflate(46.0 * s, h / 2.0 + 46.0 * s));
    }
    if scene.sweep_at.is_some() {
        if let Some(lines) = scene.lines.as_ref() {
            for l in lines {
                f.include(l.inflate(22.0 * s, 16.0 * s));
            }
        }
    }
    f.bounds
}

fn draw_scene(pm: &mut Pixmap, scene: &Scene, now: f32, tf: Transform) {
    let s = scene.scale;

    // ---- Texte illuminé (sous la comète) ----
    if let (Some(t_sweep), Some(lines)) = (scene.sweep_at, scene.lines.as_ref()) {
        let e = now - t_sweep;
        let sweep = sweep_ms(lines.len());
        // Vitesse d'écriture quasi constante, qui se pose à la fin.
        let progress = (1.0 - (1.0 - clamp01(e / sweep)).powf(1.7)) * text_length(lines);
        let fade_t = (e - sweep - HOLD_MS) / FADE_MS;
        let alpha = 1.0 - ease_in_out_cubic(fade_t.max(0.0));
        // L'encre est plus dense pendant le balayage, puis se pose.
        let settle = 1.0 - 0.22 * clamp01((e - sweep) / 300.0);
        let sweeping = e < sweep;
        let segments = revealed(lines, progress);
        let pick = |dx: f32, dy: f32| -> Vec<Rect> {
            segments.iter().map(|(r, _)| r.inflate(dx, dy)).collect()
        };

        // Halo doux (deux couches), corps d'encre, trait fin sous chaque ligne.
        fill_union(
            pm,
            &pick(7.0 * s, 4.5 * s),
            9.0 * s,
            rgba(139, 92, 246, 0.07 * alpha),
            tf,
        );
        fill_union(
            pm,
            &pick(4.0 * s, 2.5 * s),
            6.5 * s,
            rgba(139, 92, 246, 0.08 * alpha),
            tf,
        );
        let bodies = pick(2.0 * s, 1.0 * s);
        fill_union(
            pm,
            &bodies,
            4.5 * s,
            rgba(146, 106, 255, 0.27 * alpha * settle),
            tf,
        );
        let unders: Vec<Rect> = bodies
            .iter()
            .map(|b| {
                Rect::new(
                    b.x + 3.0 * s,
                    b.bottom() + 0.5 * s,
                    (b.w - 6.0 * s).max(0.0),
                    1.5 * s,
                )
            })
            .collect();
        fill_union(
            pm,
            &unders,
            0.75 * s,
            rgba(170, 140, 255, 0.7 * alpha * settle),
            tf,
        );

        // Front d'encre : reflet qui court devant, étincelle, caret qui écrit.
        if let Some((front, _)) = segments.iter().find(|(_, f)| *f).filter(|_| sweeping) {
            let body = front.inflate(2.0 * s, 1.0 * s);
            let fx = body.right();
            let fy = body.cy();
            let k = 1.0 - clamp01(e / sweep).powi(3);
            if let (Some(path), Some(sh)) = (
                round_rect(&body, 4.5 * s),
                linear(
                    (fx - 80.0 * s, 0.0),
                    (fx, 0.0),
                    &[
                        (0.0, rgba(236, 226, 255, 0.0)),
                        (1.0, rgba(236, 226, 255, 0.4 * k)),
                    ],
                ),
            ) {
                pm.fill_path(&path, &shaded(sh), FillRule::Winding, tf, None);
            }
            if let (Some(c), Some(sh)) = (
                circle(fx, fy, 18.0 * s),
                radial(
                    fx,
                    fy,
                    18.0 * s,
                    &[
                        (0.0, rgba(255, 255, 255, 0.9 * k)),
                        (0.3, rgba(214, 196, 255, 0.5 * k)),
                        (1.0, rgba(139, 92, 246, 0.0)),
                    ],
                ),
            ) {
                pm.fill_path(&c, &shaded(sh), FillRule::Winding, tf, None);
            }
            let bar = Rect::new(fx - 1.0 * s, body.y - 2.0 * s, 2.0 * s, body.h + 4.0 * s);
            fill_union(pm, &[bar], 1.0 * s, rgba(255, 255, 255, 0.9 * k), tf);
        }
    }

    // ---- Impact ----
    if let Some((t_land, (x, y), h)) = scene.land {
        let e = now - t_land;
        if e < SPLASH_MS {
            let k = clamp01(e / SPLASH_MS);
            let ring = (5.0 + 24.0 * ease_out_cubic(k)) * s;
            if let Some(c) = circle(x, y, ring) {
                let stroke = Stroke {
                    width: (1.8 * (1.0 - k) + 0.4) * s,
                    ..Default::default()
                };
                pm.stroke_path(
                    &c,
                    &solid(rgba(206, 188, 255, 0.85 * (1.0 - k))),
                    &stroke,
                    tf,
                    None,
                );
            }
            let g = clamp01(1.0 - e / 360.0);
            if g > 0.0 {
                if let Some(sh) = radial(
                    x,
                    y,
                    30.0 * s,
                    &[
                        (0.0, rgba(255, 244, 236, 0.75 * g)),
                        (0.3, rgba(196, 160, 255, 0.4 * g)),
                        (1.0, rgba(139, 92, 246, 0.0)),
                    ],
                ) {
                    if let Some(c) = circle(x, y, 30.0 * s) {
                        pm.fill_path(&c, &shaded(sh), FillRule::Winding, tf, None);
                    }
                }
                // Le caret s'embrase une fraction de seconde.
                let bar = Rect::new(x - 1.5 * s, y - h / 2.0 - 3.0 * s, 3.0 * s, h + 6.0 * s);
                if let Some(path) = round_rect(&bar, 1.5 * s) {
                    pm.fill_path(
                        &path,
                        &solid(rgba(255, 255, 255, 0.95 * g * g)),
                        FillRule::Winding,
                        tf,
                        None,
                    );
                }
            }
        }
    }

    // ---- Comète ----
    if let Some((flight, t_start, ms)) = scene.flight {
        let p = clamp01((now - t_start) / ms);
        draw_comet(pm, &flight, p, ms, s, tf);
    }
}

fn draw_comet(pm: &mut Pixmap, flight: &Flight, p: f32, ms: f32, s: f32, tf: Transform) {
    // Apparition hors de l'orbe, léger rétrécissement à l'arrivée.
    let emerge = clamp01(p / 0.12);
    let size = s * (1.0 - 0.25 * clamp01((p - 0.7) / 0.3));

    // Traîne : points de la trajectoire aux instants passés (s'étire avec la vitesse).
    const N: usize = 20;
    let span = (0.17 * 360.0 / ms).min(0.24);
    let pts: Vec<(f32, f32)> = (0..=N)
        .map(|i| flight.point(ease_in_out_cubic((p - span * i as f32 / N as f32).max(0.0))))
        .collect();
    let head = pts[0];
    let tail = pts[N];

    let ribbon = |width: f32| -> Option<Path> {
        let mut left = Vec::with_capacity(N + 1);
        let mut right = Vec::with_capacity(N + 1);
        for i in 0..=N {
            let a = pts[i.saturating_sub(1)];
            let b = pts[(i + 1).min(N)];
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let len = (dx * dx + dy * dy).sqrt();
            let (nx, ny) = if len > 1e-3 {
                (-dy / len, dx / len)
            } else {
                (0.0, 0.0)
            };
            let w = width * (1.0 - i as f32 / N as f32).powf(1.4);
            left.push((pts[i].0 + nx * w, pts[i].1 + ny * w));
            right.push((pts[i].0 - nx * w, pts[i].1 - ny * w));
        }
        let mut pb = PathBuilder::new();
        pb.move_to(left[0].0, left[0].1);
        for q in &left[1..] {
            pb.line_to(q.0, q.1);
        }
        for q in right.iter().rev() {
            pb.line_to(q.0, q.1);
        }
        pb.close();
        pb.finish()
    };

    if (head.0 - tail.0).abs() + (head.1 - tail.1).abs() > 1.0 {
        if let (Some(glow), Some(sh)) = (
            ribbon(10.0 * size),
            linear(
                head,
                tail,
                &[
                    (0.0, rgba(140, 96, 255, 0.42 * emerge)),
                    (1.0, rgba(124, 77, 255, 0.0)),
                ],
            ),
        ) {
            pm.fill_path(&glow, &shaded(sh), FillRule::Winding, tf, None);
        }
        if let (Some(core), Some(sh)) = (
            ribbon(3.0 * size),
            linear(
                head,
                tail,
                &[
                    (0.0, rgba(255, 246, 238, emerge)),
                    (0.3, rgba(196, 164, 255, 0.85 * emerge)),
                    (1.0, rgba(124, 77, 255, 0.0)),
                ],
            ),
        ) {
            pm.fill_path(&core, &shaded(sh), FillRule::Winding, tf, None);
        }
    }

    // Étincelles semées le long du vol (pêche et lavande), qui dérivent et s'éteignent.
    let life = 0.26;
    let count = 26u32;
    for j in 0..count {
        let born = j as f32 / count as f32 * 0.92;
        let age = (p - born) / life;
        if !(0.0..1.0).contains(&age) {
            continue;
        }
        let at = flight.point(ease_in_out_cubic(born));
        let next = flight.point(ease_in_out_cubic((born + 0.02).min(1.0)));
        let (dx, dy) = (next.0 - at.0, next.1 - at.1);
        let len = (dx * dx + dy * dy).sqrt().max(1e-3);
        let side = if hash(j) > 0.5 { 1.0 } else { -1.0 };
        let drift = (5.0 + 10.0 * hash(j + 97)) * s * ease_out_cubic(age) * side;
        let x = at.0 + (-dy / len) * drift;
        let y = at.1 + (dx / len) * drift + 6.0 * s * age * age;
        let r = (0.8 + 1.1 * hash(j + 31)) * s * (1.0 - age);
        let color = if j % 3 == 0 {
            rgba(255, 196, 164, 0.9 * (1.0 - age))
        } else {
            rgba(206, 188, 255, 0.9 * (1.0 - age))
        };
        if let Some(c) = circle(x, y, r) {
            pm.fill_path(&c, &solid(color), FillRule::Winding, tf, None);
        }
    }

    // Tête : aura violette (lisible même sur fond blanc), halo spectral, noyau blanc.
    let ar = 34.0 * size;
    if let (Some(c), Some(sh)) = (
        circle(head.0, head.1, ar),
        radial(
            head.0,
            head.1,
            ar,
            &[
                (0.0, rgba(140, 96, 255, 0.22 * emerge)),
                (1.0, rgba(140, 96, 255, 0.0)),
            ],
        ),
    ) {
        pm.fill_path(&c, &shaded(sh), FillRule::Winding, tf, None);
    }
    let hr = 19.0 * size;
    if let (Some(c), Some(sh)) = (
        circle(head.0, head.1, hr),
        radial(
            head.0,
            head.1,
            hr,
            &[
                (0.0, rgba(255, 255, 255, emerge)),
                (0.14, rgba(255, 232, 214, 0.95 * emerge)),
                (0.4, rgba(180, 140, 255, 0.55 * emerge)),
                (1.0, rgba(139, 92, 246, 0.0)),
            ],
        ),
    ) {
        pm.fill_path(&c, &shaded(sh), FillRule::Winding, tf, None);
    }
    if let Some(c) = circle(head.0, head.1, 2.4 * size) {
        pm.fill_path(
            &c,
            &solid(rgba(255, 255, 255, emerge)),
            FillRule::Winding,
            tf,
            None,
        );
    }
}

// ------------------------------------------------------------------ fenêtre native

struct Surface {
    hwnd: HWND,
    screen_dc: windows_sys::Win32::Graphics::Gdi::HDC,
    mem_dc: windows_sys::Win32::Graphics::Gdi::HDC,
    shown: bool,
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_NCHITTEST {
        return HTTRANSPARENT as LRESULT; // la souris traverse, toujours
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

impl Surface {
    fn new() -> Option<Self> {
        use std::sync::OnceLock;
        static CLASS: OnceLock<Vec<u16>> = OnceLock::new();
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = CLASS.get_or_init(|| {
                let name = wide("AsasVoiceDeliveryFx");
                let wc = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    lpfnWndProc: Some(wndproc),
                    hInstance: instance,
                    lpszClassName: name.as_ptr(),
                    ..std::mem::zeroed()
                };
                RegisterClassExW(&wc);
                name
            });
            let title = wide("Asas Voice");
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED
                    | WS_EX_TRANSPARENT
                    | WS_EX_TOOLWINDOW
                    | WS_EX_NOACTIVATE
                    | WS_EX_TOPMOST,
                class.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                0,
                0,
                1,
                1,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return None;
            }
            let screen_dc = GetDC(std::ptr::null_mut());
            let mem_dc = CreateCompatibleDC(screen_dc);
            Some(Self {
                hwnd,
                screen_dc,
                mem_dc,
                shown: false,
            })
        }
    }

    /// Dessine la scène et la présente. Faux si la présentation échoue (on arrête).
    fn draw(&mut self, scene: &Scene, now: f32) -> bool {
        let Some(b) = scene_bounds(scene, now) else {
            return true; // rien à montrer à cet instant (en attente de la sonde)
        };
        let x = b.x.floor() as i32;
        let y = b.y.floor() as i32;
        let w = ((b.right().ceil() as i32) - x).clamp(1, 4096);
        let h = ((b.bottom().ceil() as i32) - y).clamp(1, 4096);
        let Some(mut pm) = Pixmap::new(w as u32, h as u32) else {
            return false;
        };
        draw_scene(
            &mut pm,
            scene,
            now,
            Transform::from_translate(-x as f32, -y as f32),
        );
        self.present(&pm, x, y)
    }

    /// Présente une image (RGBA prémultiplié) à la position écran (x, y), en pixels physiques.
    fn present(&mut self, pm: &Pixmap, x: i32, y: i32) -> bool {
        let (w, h) = (pm.width() as i32, pm.height() as i32);
        unsafe {
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // de haut en bas
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    ..std::mem::zeroed()
                },
                ..std::mem::zeroed()
            };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let dib = CreateDIBSection(
                self.screen_dc,
                &bmi,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            if dib.is_null() || bits.is_null() {
                fx_log!("CreateDIBSection a échoué ({w}x{h})");
                return false;
            }
            // tiny-skia : RGBA prémultiplié → GDI : BGRA prémultiplié.
            let src = pm.data();
            let dst = std::slice::from_raw_parts_mut(bits as *mut u8, src.len());
            for (d, s) in dst
                .as_chunks_mut::<4>()
                .0
                .iter_mut()
                .zip(src.as_chunks::<4>().0)
            {
                d[0] = s[2];
                d[1] = s[1];
                d[2] = s[0];
                d[3] = s[3];
            }
            let old = SelectObject(self.mem_dc, dib);
            let dst_pt = POINT { x, y };
            let size = SIZE { cx: w, cy: h };
            let src_pt = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            let ok = UpdateLayeredWindow(
                self.hwnd,
                self.screen_dc,
                &dst_pt,
                &size,
                self.mem_dc,
                &src_pt,
                0,
                &blend,
                ULW_ALPHA,
            );
            SelectObject(self.mem_dc, old);
            DeleteObject(dib);
            if ok == 0 {
                fx_log!("UpdateLayeredWindow a échoué ({w}x{h} en {x},{y})");
                return false;
            }
            if !self.shown {
                ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                self.shown = true;
                #[cfg(debug_assertions)]
                {
                    let lit = pm
                        .data()
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .filter(|p| p[3] > 0)
                        .count();
                    fx_log!("1re image : {w}x{h} en {x},{y}, {lit} pixels visibles");
                }
            }
        }
        true
    }

    /// Traite les messages de la fenêtre (sinon Windows la croirait figée).
    fn pump(&self) {
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    fn destroy(self) {
        unsafe {
            DeleteDC(self.mem_dc);
            ReleaseDC(std::ptr::null_mut(), self.screen_dc);
            DestroyWindow(self.hwnd);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiny_skia::{IntSize, PixmapPaint};

    /// Planche de contact de l'effet, sur un document clair et un éditeur sombre :
    /// `cargo test --lib fx::tests::planche -- --ignored` → target/fx-planche.png
    #[test]
    #[ignore]
    fn planche() {
        let (w, h) = (620u32, 360u32);
        let lines = vec![
            Rect::new(96.0, 92.0, 402.0, 19.0),
            Rect::new(60.0, 118.0, 470.0, 19.0),
            Rect::new(60.0, 144.0, 212.0, 19.0),
        ];
        let origin = (470.0, 300.0, 22.0);
        let flight = Flight::new(
            (origin.0 - 10.0, origin.1 - 20.0),
            (lines[0].x, lines[0].cy()),
        );
        let fms = flight_ms(flight.length(), 1.0);
        let base = |now: f32| {
            Scene {
                scale: 1.0,
                origin: Some(origin),
                pre: Some(Rect::new(96.0, 92.0, 2.0, 19.0)),
                lines: Some(lines.clone()),
                end: None,
                flight: None,
                land: None,
                sweep_at: None,
            }
            .with(now)
        };
        let frames: Vec<(f32, Scene)> = vec![
            (40.0, {
                let mut s = base(0.0);
                s.flight = Some((flight, 0.0, fms));
                s
            }),
            (fms * 0.45, {
                let mut s = base(0.0);
                s.flight = Some((flight, 0.0, fms));
                s
            }),
            (fms * 0.85, {
                let mut s = base(0.0);
                s.flight = Some((flight, 0.0, fms));
                s
            }),
            (fms + 60.0, {
                let mut s = base(0.0);
                s.land = Some((fms, flight.e, 19.0));
                s.sweep_at = Some(fms);
                s
            }),
            (fms + 200.0, {
                let mut s = base(0.0);
                s.land = Some((fms, flight.e, 19.0));
                s.sweep_at = Some(fms);
                s
            }),
            (fms + 700.0, {
                let mut s = base(0.0);
                s.land = Some((fms, flight.e, 19.0));
                s.sweep_at = Some(fms);
                s
            }),
            (fms + 1250.0, {
                let mut s = base(0.0);
                s.land = Some((fms, flight.e, 19.0));
                s.sweep_at = Some(fms);
                s
            }),
        ];
        let cols = frames.len() as u32;
        let mut sheet = Pixmap::new(w * cols, h * 2).unwrap();
        for (row, dark) in [false, true].into_iter().enumerate() {
            for (col, (now, scene)) in frames.iter().enumerate() {
                let mut pm = Pixmap::new(w, h).unwrap();
                let (bg, ink) = if dark {
                    (rgba(30, 30, 36, 1.0), rgba(200, 200, 210, 1.0))
                } else {
                    (rgba(255, 255, 255, 1.0), rgba(40, 40, 48, 1.0))
                };
                pm.fill(bg);
                for (i, l) in lines.iter().enumerate() {
                    // « mots » factices
                    let mut x = l.x;
                    let mut k = i as u32 * 7;
                    while x < l.right() - 8.0 {
                        let ww = 14.0 + 40.0 * hash(k);
                        let r = Rect::new(x, l.y + 5.0, ww.min(l.right() - x), 9.0);
                        if let Some(p) = round_rect(&r, 2.0) {
                            pm.fill_path(
                                &p,
                                &solid(ink),
                                FillRule::Winding,
                                Transform::identity(),
                                None,
                            );
                        }
                        x += ww + 6.0;
                        k += 1;
                    }
                }
                if let Some(c) = circle(origin.0, origin.1, origin.2) {
                    pm.fill_path(
                        &c,
                        &solid(rgba(165, 107, 255, 1.0)),
                        FillRule::Winding,
                        Transform::identity(),
                        None,
                    );
                }
                draw_scene(&mut pm, scene, *now, Transform::identity());
                pm.save_png(format!("target/fx-{row}-{col}.png")).unwrap();
                sheet.draw_pixmap(
                    (col as u32 * w) as i32,
                    (row as u32 * h) as i32,
                    pm.as_ref(),
                    &PixmapPaint::default(),
                    Transform::identity(),
                    None,
                );
            }
        }
        let _ = IntSize::from_wh(1, 1);
        sheet.save_png("target/fx-planche.png").unwrap();
    }

    impl Scene {
        fn with(self, _now: f32) -> Self {
            self
        }
    }

    /// Fenêtre superposée réelle, 3 s, texte illuminé figé autour de (300, 300) :
    /// `cargo test --lib fx::tests::fenetre -- --ignored`
    #[test]
    #[ignore]
    fn fenetre() {
        let lines = vec![
            Rect::new(300.0, 300.0, 500.0, 30.0),
            Rect::new(300.0, 340.0, 300.0, 30.0),
        ];
        let scene = Scene {
            scale: 1.5,
            origin: None,
            pre: None,
            lines: Some(lines),
            end: None,
            flight: None,
            land: Some((0.0, (300.0, 315.0), 30.0)),
            sweep_at: Some(0.0),
        };
        let mut surface = Surface::new().expect("fenêtre");
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(3) {
            // Figé en fin de balayage (texte illuminé).
            assert!(surface.draw(&scene, 500.0), "présentation");
            surface.pump();
            std::thread::sleep(Duration::from_millis(16));
        }
        surface.destroy();
    }
}
