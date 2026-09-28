//! Fenêtre orbe flottante : création, placement mémorisé, visibilité, et « sens » du
//! curseur.
//!
//! La fenêtre est un carré transparent toujours au-dessus. Sans précaution, tout ce carré
//! intercepterait les clics — y compris ses coins invisibles. Un fil léger (Windows)
//! compare la position du curseur au disque de l'orbe et bascule la fenêtre en
//! clic-traversant dès que le curseur n'est pas SUR l'orbe. Le même fil informe l'orbe
//! de l'approche du curseur et des déplacements de la fenêtre (physique), et mémorise
//! la position quand on la pose ailleurs. Coût : quelques appels Win32 triviaux, 8 à
//! 25 fois par seconde, rien quand l'orbe est masquée.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

/// Label Tauri de la fenêtre orbe.
pub const ORB_LABEL: &str = "orb";
/// Côté de la fenêtre orbe (px logiques). L'orbe dessinée occupe ~2/3 du carré.
const ORB_SIZE: f64 = 132.0;
/// Marge au-dessus de la barre des tâches pour la position par défaut (px logiques).
const BOTTOM_MARGIN: f64 = 60.0;
/// Rayon « attrapable » de l'orbe, en fraction du côté de la fenêtre (cœur + anneau).
#[cfg(windows)]
const GRAB_RADIUS: f64 = 0.30;
/// Au-delà de cette distance (en côtés de fenêtre), le curseur n'influence plus l'orbe.
#[cfg(windows)]
const SENSE_RADIUS: f64 = 1.9;
/// Délai avant de cacher la fenêtre : la page joue d'abord sa sortie (OUTRO_MS = 240 ms
/// côté TypeScript) et finit sur un canvas vide ; la marge couvre une image en retard.
const HIDE_AFTER_OUTRO: Duration = Duration::from_millis(320);

/// Event « sens » (miroir de ORB_SENSE_EVENT côté TypeScript).
const ORB_SENSE_EVENT: &str = "orb-sense";
/// Event de visibilité (miroir de WINDOW_VISIBILITY_EVENT côté TypeScript).
pub const WINDOW_VISIBILITY_EVENT: &str = "window-visibility";

#[derive(Clone, Serialize)]
pub struct WindowVisibility {
    pub label: &'static str,
    pub visible: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Serialize)]
struct OrbSense {
    x: Option<f64>,
    y: Option<f64>,
    vx: f64,
    vy: f64,
}

/// Position mémorisée (coin haut-gauche, pixels physiques du bureau virtuel).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct SavedPosition {
    pub x: i32,
    pub y: i32,
}

/// Visibilité courante de l'orbe (évite les bascules et events redondants).
pub struct OrbState {
    visible: Mutex<bool>,
    /// Incrémenté à chaque bascule : un masquage différé devenu obsolète (l'orbe a été
    /// rappelée pendant sa sortie) ne s'applique pas.
    generation: AtomicU64,
}

impl OrbState {
    pub fn new() -> Self {
        Self {
            visible: Mutex::new(true),
            generation: AtomicU64::new(0),
        }
    }
}

fn position_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("orb-position.json"))
}

fn load_position(app: &AppHandle) -> Option<SavedPosition> {
    let raw = std::fs::read_to_string(position_file(app)?).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn save_position(app: &AppHandle, pos: SavedPosition) {
    if let Some(path) = position_file(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&pos) {
            let _ = std::fs::write(path, json);
        }
    }
}

/// Rectangle d'un écran (pixels physiques du bureau virtuel).
#[derive(Clone, Copy, Debug)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Vrai si le centre de la fenêtre orbe (coin `pos`, côté `size` px) tombe sur un écran
/// existant. Sert à ignorer une position mémorisée sur un écran débranché depuis.
pub fn position_is_visible(pos: SavedPosition, size: i32, monitors: &[MonitorRect]) -> bool {
    let cx = pos.x + size / 2;
    let cy = pos.y + size / 2;
    monitors
        .iter()
        .any(|m| cx >= m.x && cx < m.x + m.width as i32 && cy >= m.y && cy < m.y + m.height as i32)
}

fn monitor_rects(window: &WebviewWindow) -> Vec<MonitorRect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect()
}

/// Place l'orbe en bas au centre de l'écran principal.
fn place_default(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let pos = monitor.position();
        let size = monitor.size();
        let side = (ORB_SIZE * scale).round();
        let x = pos.x as f64 + (size.width as f64 - side) / 2.0;
        let y = pos.y as f64 + size.height as f64 - side - BOTTOM_MARGIN * scale;
        let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
}

/// Crée la fenêtre orbe : transparente, sans décorations, toujours au-dessus, hors barre
/// des tâches, sans voler le focus ; à la position mémorisée si elle est encore visible.
pub fn spawn(app: &AppHandle) -> tauri::Result<()> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let orb = WebviewWindowBuilder::new(app, ORB_LABEL, WebviewUrl::App("orb.html".into()))
        .title("Asas Voice")
        .inner_size(ORB_SIZE, ORB_SIZE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false) // ne vole pas le focus de l'app active
        .visible(true)
        .build()?;

    let side = orb
        .outer_size()
        .map(|s| s.width as i32)
        .unwrap_or(ORB_SIZE as i32);
    match load_position(app) {
        Some(pos) if position_is_visible(pos, side, &monitor_rects(&orb)) => {
            let _ = orb.set_position(PhysicalPosition::new(pos.x, pos.y));
        }
        _ => place_default(&orb),
    }

    #[cfg(windows)]
    spawn_tracker(app.clone(), &orb);

    Ok(())
}

/// Replace l'orbe en bas au centre de l'écran principal (et oublie l'ancienne position).
pub fn reset_position(app: &AppHandle) {
    if let Some(orb) = app.get_webview_window(ORB_LABEL) {
        place_default(&orb);
        if let Some(path) = position_file(app) {
            let _ = std::fs::remove_file(path);
        }
        set_visible(app, true);
    }
}

/// Affiche / masque l'orbe SANS l'activer (le champ où l'on dicte garde le focus), et
/// prévient la page pour qu'elle joue son entrée ou sa sortie.
///
/// Masquage : la page reçoit l'event d'abord et l'orbe se rétracte en s'effaçant ; la
/// fenêtre n'est cachée qu'ensuite (HIDE_AFTER_OUTRO), si rien ne l'a rappelée entre-temps.
/// Elle se cache donc sur un canvas vide, que Windows réaffichera tel quel au prochain
/// affichage : l'entrée part de rien, sans flash de l'ancienne image.
pub fn set_visible(app: &AppHandle, visible: bool) {
    let Some(orb) = app.get_webview_window(ORB_LABEL) else {
        return;
    };
    let mut generation = 0;
    if let Some(state) = app.try_state::<OrbState>() {
        if let Ok(mut current) = state.visible.lock() {
            if *current == visible {
                return;
            }
            *current = visible;
            generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
        }
    }

    if visible {
        // Annule de fait un masquage en attente (génération changée) ; sans effet si la
        // fenêtre est encore affichée pendant sa sortie.
        show_window(&orb, true);
    }

    let _ = app.emit_to(
        ORB_LABEL,
        WINDOW_VISIBILITY_EVENT,
        WindowVisibility {
            label: ORB_LABEL,
            visible,
        },
    );

    if !visible {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(HIDE_AFTER_OUTRO);
            let handle = app.clone();
            // Les fenêtres se manipulent depuis le fil principal.
            let _ = app.run_on_main_thread(move || {
                let still_hidden = handle.try_state::<OrbState>().is_none_or(|state| {
                    state.generation.load(Ordering::SeqCst) == generation
                        && state.visible.lock().map(|v| !*v).unwrap_or(false)
                });
                if still_hidden {
                    if let Some(orb) = handle.get_webview_window(ORB_LABEL) {
                        show_window(&orb, false);
                    }
                }
            });
        });
    }
}

/// Affiche (sans activer) ou cache la fenêtre orbe.
fn show_window(orb: &WebviewWindow, visible: bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE};
        match orb.hwnd() {
            Ok(hwnd) => unsafe {
                ShowWindow(
                    hwnd.0 as _,
                    if visible { SW_SHOWNOACTIVATE } else { SW_HIDE },
                );
            },
            Err(_) => {
                let _ = if visible { orb.show() } else { orb.hide() };
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = if visible { orb.show() } else { orb.hide() };
    }
}

/// Fil de suivi (Windows) : clic-traversant hors de l'orbe, sens du curseur, mouvement,
/// mémorisation de la position.
#[cfg(windows)]
fn spawn_tracker(app: AppHandle, orb: &WebviewWindow) {
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowRect, IsWindowVisible,
    };

    let Ok(hwnd) = orb.hwnd() else {
        return;
    };
    // HWND n'est pas Send : on le transporte comme entier.
    let hwnd_raw = hwnd.0 as isize;
    let orb = orb.clone();

    std::thread::spawn(move || {
        let hwnd = hwnd_raw as windows_sys::Win32::Foundation::HWND;
        let mut ignoring = false; // la fenêtre naît cliquable
        let mut was_near = false;
        let mut last_sent: Option<(i32, i32)> = None;
        let mut last_rect: Option<RECT> = None;
        let mut last_tick = Instant::now();
        let mut moved_at: Option<Instant> = None;

        loop {
            let visible = unsafe { IsWindowVisible(hwnd) } != 0;
            if !visible {
                was_near = false;
                last_sent = None;
                last_rect = None;
                std::thread::sleep(Duration::from_millis(300));
                last_tick = Instant::now();
                continue;
            }

            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let mut pt = POINT { x: 0, y: 0 };
            let ok_rect = unsafe { GetWindowRect(hwnd, &mut rect) } != 0;
            let ok_pt = unsafe { GetCursorPos(&mut pt) } != 0;
            if !ok_rect || !ok_pt {
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }

            let now = Instant::now();
            let dt = now.duration_since(last_tick).as_secs_f64().max(1e-3);
            last_tick = now;

            let side = (rect.right - rect.left).max(1) as f64;
            let half = side / 2.0;
            let cx = rect.left as f64 + half;
            let cy = rect.top as f64 + half;
            let dx = pt.x as f64 - cx;
            let dy = pt.y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            // 1) Clic-traversant partout sauf sur l'orbe elle-même.
            let inside = dist <= GRAB_RADIUS * side;
            if inside == ignoring {
                ignoring = !inside;
                let _ = orb.set_ignore_cursor_events(ignoring);
            }

            // 2) Mouvement de la fenêtre (en côtés de fenêtre par seconde).
            let (mut vx, mut vy) = (0.0, 0.0);
            let moving = match last_rect {
                Some(prev) if prev.left != rect.left || prev.top != rect.top => {
                    vx = (rect.left - prev.left) as f64 / side / dt;
                    vy = (rect.top - prev.top) as f64 / side / dt;
                    moved_at = Some(now);
                    true
                }
                _ => false,
            };
            last_rect = Some(rect);

            // 3) Sens du curseur : on n'émet que si le curseur est proche ET a bougé, ou si
            //    la fenêtre bouge. Curseur garé à côté de l'orbe = aucun message.
            let near = dist <= SENSE_RADIUS * side;
            let cursor_moved = last_sent != Some((pt.x, pt.y));
            if (near && cursor_moved) || moving {
                last_sent = Some((pt.x, pt.y));
                let sense = OrbSense {
                    x: near.then_some(dx / half),
                    y: near.then_some(dy / half),
                    vx,
                    vy,
                };
                let _ = app.emit_to(ORB_LABEL, ORB_SENSE_EVENT, sense);
            } else if was_near && !near {
                last_sent = None;
                let _ = app.emit_to(
                    ORB_LABEL,
                    ORB_SENSE_EVENT,
                    OrbSense {
                        x: None,
                        y: None,
                        vx: 0.0,
                        vy: 0.0,
                    },
                );
            }
            was_near = near;

            // 4) Position posée depuis 600 ms → mémorisée.
            if let Some(at) = moved_at {
                if now.duration_since(at) > Duration::from_millis(600) {
                    moved_at = None;
                    save_position(
                        &app,
                        SavedPosition {
                            x: rect.left,
                            y: rect.top,
                        },
                    );
                }
            }

            let pause = if near || moving || moved_at.is_some() {
                40
            } else {
                120
            };
            std::thread::sleep(Duration::from_millis(pause));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(x: i32, y: i32, width: u32, height: u32) -> MonitorRect {
        MonitorRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn position_sur_un_ecran_existant() {
        let monitors = [screen(0, 0, 1920, 1080)];
        assert!(position_is_visible(
            SavedPosition { x: 900, y: 900 },
            132,
            &monitors
        ));
    }

    #[test]
    fn position_sur_un_ecran_debranche_ignoree() {
        // Deuxième écran à droite, débranché depuis : seul l'écran principal subsiste.
        let monitors = [screen(0, 0, 1920, 1080)];
        assert!(!position_is_visible(
            SavedPosition { x: 2500, y: 400 },
            132,
            &monitors
        ));
    }

    #[test]
    fn position_sur_un_ecran_a_gauche_coordonnees_negatives() {
        let monitors = [screen(0, 0, 1920, 1080), screen(-1280, 0, 1280, 1024)];
        assert!(position_is_visible(
            SavedPosition { x: -700, y: 500 },
            132,
            &monitors
        ));
    }

    #[test]
    fn position_a_cheval_juge_par_le_centre() {
        let monitors = [screen(0, 0, 1920, 1080)];
        // Coin hors écran mais centre visible : acceptée.
        assert!(position_is_visible(
            SavedPosition { x: -40, y: 100 },
            132,
            &monitors
        ));
        // Centre hors écran : refusée.
        assert!(!position_is_visible(
            SavedPosition { x: -100, y: 100 },
            132,
            &monitors
        ));
    }
}
