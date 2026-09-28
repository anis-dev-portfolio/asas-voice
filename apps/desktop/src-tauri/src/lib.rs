#[cfg(windows)]
mod caret;
#[cfg_attr(not(windows), allow(dead_code))]
mod delivery;
#[cfg(windows)]
mod fx;
mod orb;

use serde::Deserialize;
use std::sync::Mutex;
use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Fenêtre cible (HWND en isize sous Windows) mémorisée au début de la dictée,
/// pour y restaurer le focus avant de coller — peu importe ce qui a pris le focus entre-temps.
struct DictationState {
    target: Mutex<Option<isize>>,
}

/// Argument passé par l'entrée « démarrage auto » : lancer réduit dans le tray.
const START_MINIMIZED_ARG: &str = "--minimized";

/// Port local du backend (fixe : le CSP de la webview n'autorise que cette origine).
const BACKEND_PORT: u16 = 4321;
/// Service / utilisateur de l'entrée Windows Credential Manager pour la clé API.
const KEYRING_SERVICE: &str = "com.asasvoice.app";
const KEYRING_USER: &str = "mistral_api_key";
const KEYRING_USER_ANTHROPIC: &str = "anthropic_api_key";

/// Process du backend Fastify embarqué (sidecar), lancé/arrêté par l'app. `None` quand
/// l'app n'en possède pas (ex. en dev, un backend lancé à la main occupe déjà le port).
struct BackendState {
    child: Mutex<Option<CommandChild>>,
}

/// Lit la clé API depuis le trousseau OS (None si absente ou vide).
fn read_api_key() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => Some(key),
        _ => None,
    }
}

/// Écrit la clé API dans le trousseau OS (chiffrée par l'OS, jamais en clair sur disque).
fn write_api_key(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

/// Supprime la clé API du trousseau (no-op si elle n'existe pas).
fn delete_api_key() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ─── Clé Anthropic (post-traitement Claude) ────────────────────────────────

fn read_anthropic_key() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_ANTHROPIC).ok()?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => Some(key),
        _ => None,
    }
}

fn write_anthropic_key(key: &str) -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_ANTHROPIC).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

fn delete_anthropic_key() -> Result<(), String> {
    let entry =
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_ANTHROPIC).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Assigne un process à un Job Object « kill on close » : tout process du job est tué
/// par l'OS quand le dernier handle du job se ferme — c'est-à-dire quand NOTRE process
/// se termine, y compris par crash ou Ctrl+C. Sans ça, un sidecar orphelin survit à
/// l'app, garde le port 4321 et verrouille son .exe (rebuilds impossibles).
#[cfg(windows)]
fn assign_to_kill_on_close_job(pid: u32) {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    // Handle du job volontairement jamais fermé : l'OS le ferme à la mort du process,
    // ce qui tue les sidecars assignés (stocké en isize pour être Sync).
    static JOB: OnceLock<isize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return 0;
        }
        job as isize
    });
    if job == 0 {
        return;
    }
    unsafe {
        let process: HANDLE = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if !process.is_null() {
            let _ = AssignProcessToJobObject(job as HANDLE, process);
            CloseHandle(process);
        }
    }
}

/// Vrai si quelque chose écoute déjà sur le port du backend (ex. `pnpm dev:backend`).
fn backend_already_up() -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr: SocketAddr = ([127, 0, 0, 1], BACKEND_PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// (Re)lance le backend sidecar avec la clé API du trousseau injectée en variable
/// d'environnement. Tue d'abord le process qu'on possédait. Ne lance rien si un backend
/// externe occupe déjà le port (dev). Le backend lit `PORT` et `MISTRAL_API_KEY` (env.ts).
fn spawn_backend(app: &tauri::AppHandle, backend: &BackendState) {
    // Tue le process qu'on possédait (changement de clé = redémarrage propre).
    let killed = backend
        .child
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
        .map(|child| {
            let _ = child.kill();
        })
        .is_some();
    // Attend que le port se libère VRAIMENT (évite EADDRINUSE côté Node). Un délai fixe
    // est une course : si l'ancien process traîne, le check « déjà occupé » plus bas
    // verrait le port du process mourant et on ne relancerait jamais le backend.
    if killed {
        for _ in 0..30 {
            if !backend_already_up() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    // Un backend externe (pnpm dev:backend) occupe le port : on ne double pas.
    if backend_already_up() {
        return;
    }

    let command = match app.shell().sidecar("asas-voice-backend") {
        Ok(cmd) => cmd,
        Err(err) => {
            eprintln!("[backend] sidecar introuvable : {err}");
            return;
        }
    };
    let mut command = command.env("PORT", BACKEND_PORT.to_string());
    if let Some(key) = read_api_key() {
        command = command.env("MISTRAL_API_KEY", key);
    }
    if let Some(key) = read_anthropic_key() {
        command = command.env("ANTHROPIC_API_KEY", key);
    }

    match command.spawn() {
        Ok((mut rx, child)) => {
            // Lie la vie du sidecar à celle de l'app : l'OS le tue si on meurt sans
            // passer par kill_backend (crash, Ctrl+C de `tauri dev`…).
            #[cfg(windows)]
            assign_to_kill_on_close_job(child.pid());
            if let Ok(mut slot) = backend.child.lock() {
                *slot = Some(child);
            }
            // Draine la sortie du sidecar (sinon le pipe se remplit et bloque le process).
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Terminated(_) = event {
                        break;
                    }
                }
            });
        }
        Err(err) => eprintln!("[backend] échec du lancement : {err}"),
    }
}

/// Tue le backend qu'on possède (à l'extinction de l'app).
fn kill_backend(backend: &BackendState) {
    if let Ok(mut slot) = backend.child.lock() {
        if let Some(child) = slot.take() {
            let _ = child.kill();
        }
    }
}

/// Vrai si une clé API est enregistrée (jamais la clé elle-même).
#[tauri::command]
fn api_key_is_set() -> bool {
    read_api_key().is_some()
}

/// Enregistre la clé API (trousseau OS) puis (re)lance le backend avec.
#[tauri::command]
fn set_api_key(
    app: tauri::AppHandle,
    backend: tauri::State<'_, BackendState>,
    key: String,
) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Clé API vide.".into());
    }
    write_api_key(trimmed)?;
    spawn_backend(&app, backend.inner());
    Ok(())
}

/// Efface la clé API puis relance le backend sans clé.
#[tauri::command]
fn clear_api_key(
    app: tauri::AppHandle,
    backend: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    delete_api_key()?;
    spawn_backend(&app, backend.inner());
    Ok(())
}

/// Vrai si une clé Anthropic est enregistrée (jamais la clé elle-même).
#[tauri::command]
fn anthropic_key_is_set() -> bool {
    read_anthropic_key().is_some()
}

/// Enregistre la clé Anthropic (trousseau OS) puis (re)lance le backend avec.
#[tauri::command]
fn set_anthropic_key(
    app: tauri::AppHandle,
    backend: tauri::State<'_, BackendState>,
    key: String,
) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Clé API vide.".into());
    }
    write_anthropic_key(trimmed)?;
    spawn_backend(&app, backend.inner());
    Ok(())
}

/// Efface la clé Anthropic puis relance le backend sans elle.
#[tauri::command]
fn clear_anthropic_key(
    app: tauri::AppHandle,
    backend: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    delete_anthropic_key()?;
    spawn_backend(&app, backend.inner());
    Ok(())
}

/// (Re)lance le backend embarqué sans toucher aux clés. Sert au bouton « Relancer »
/// quand le service de transcription n'a pas démarré (sidecar introuvable/planté).
#[tauri::command]
fn restart_backend(app: tauri::AppHandle, backend: tauri::State<'_, BackendState>) {
    spawn_backend(&app, backend.inner());
}

/// Écrit un fichier texte à l'emplacement choisi (export historique). Le chemin vient du
/// dialogue natif « Enregistrer sous » ; l'écriture reste côté Rust (pas de plugin fs).
#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Échec de l'écriture : {e}"))
}

#[cfg(windows)]
fn current_foreground() -> Option<isize> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        None
    } else {
        Some(hwnd as isize)
    }
}

#[cfg(not(windows))]
fn current_foreground() -> Option<isize> {
    None
}

/// Vrai si `hwnd` est actuellement la fenêtre de premier plan.
#[cfg(windows)]
fn is_foreground(hwnd: isize) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let fg = unsafe { GetForegroundWindow() };
    !(hwnd as HWND).is_null() && fg == hwnd as HWND
}

/// Ramène la fenêtre cible au premier plan (astuce AttachThreadInput pour contourner
/// la restriction de SetForegroundWindow). Renvoie vrai si la cible est bien au premier plan.
#[cfg(windows)]
fn restore_focus(hwnd: isize) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    let target = hwnd as HWND;
    if target.is_null() {
        return false;
    }
    unsafe {
        let fg = GetForegroundWindow();
        if fg == target {
            return true; // déjà au premier plan
        }
        let cur = GetCurrentThreadId();
        let fg_thread = if fg.is_null() {
            0
        } else {
            GetWindowThreadProcessId(fg, std::ptr::null_mut())
        };
        let target_thread = GetWindowThreadProcessId(target, std::ptr::null_mut());

        if fg_thread != 0 && fg_thread != cur {
            AttachThreadInput(cur, fg_thread, 1);
        }
        if target_thread != 0 && target_thread != cur {
            AttachThreadInput(cur, target_thread, 1);
        }
        // Désépingle/restaure si la fenêtre cible était minimisée, sinon le collage tomberait dans le vide.
        if IsIconic(target) != 0 {
            ShowWindow(target, SW_RESTORE);
        } else {
            ShowWindow(target, SW_SHOW);
        }
        BringWindowToTop(target);
        SetForegroundWindow(target);
        if fg_thread != 0 && fg_thread != cur {
            AttachThreadInput(cur, fg_thread, 0);
        }
        if target_thread != 0 && target_thread != cur {
            AttachThreadInput(cur, target_thread, 0);
        }
        GetForegroundWindow() == target
    }
}

#[cfg(not(windows))]
fn restore_focus(_hwnd: isize) -> bool {
    false
}

#[cfg(not(windows))]
fn is_foreground(_hwnd: isize) -> bool {
    false
}

/// Mémorise la fenêtre qui a le focus AU MOMENT où la dictée démarre (le champ cible).
#[tauri::command]
fn capture_target(state: tauri::State<'_, DictationState>) -> Result<(), String> {
    *state.target.lock().map_err(|e| e.to_string())? = current_foreground();
    Ok(())
}

/// Écrit le texte transcrit dans le presse-papier système.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}

/// HWND de l'orbe flottante (point de départ de l'effet « livraison »).
#[cfg(windows)]
fn orb_hwnd(app: &AppHandle) -> Option<isize> {
    app.get_webview_window(orb::ORB_LABEL)
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
}

/// Restaure le focus sur la fenêtre cible, met le texte dans le presse-papier,
/// puis simule Ctrl+V pour coller au curseur (paste-at-cursor).
///
/// `animate` : effet « livraison » (l'orbe lance le texte, qui s'illumine en violet). Il
/// n'ajoute AUCUNE attente : la sonde du curseur tourne sur un autre fil pendant la
/// pause de stabilisation qui existe de toute façon, et la comète part à l'envoi de Ctrl+V.
#[tauri::command]
fn paste_text(
    app: AppHandle,
    text: String,
    animate: Option<bool>,
    state: tauri::State<'_, DictationState>,
) -> Result<(), String> {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    #[cfg(not(windows))]
    let _ = (&app, animate);

    let chars = text.chars().count();
    {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(text).map_err(|e| e.to_string())?;
    }

    // Ramène le champ cible au premier plan, puis VÉRIFIE qu'il l'est vraiment avant de coller.
    // La restauration de focus sous Windows échoue parfois au 1er essai (verrou de premier plan,
    // fenêtre minimisée…) : on réessaie tant que la cible n'est pas au premier plan.
    let target = *state.target.lock().map_err(|e| e.to_string())?;
    if let Some(hwnd) = target {
        let mut focused = is_foreground(hwnd);
        for _ in 0..10 {
            if focused {
                break;
            }
            focused = restore_focus(hwnd);
            thread::sleep(Duration::from_millis(40));
            focused = focused || is_foreground(hwnd);
        }
        // Si on n'a pas réussi à rendre la cible active, on n'envoie pas Ctrl+V « dans le vide » :
        // le texte reste dans le presse-papier, prêt à être collé manuellement (repli copier-seulement).
        if !focused {
            return Err("Impossible de restaurer le focus sur le champ cible.".into());
        }
    }

    // Effet « livraison » : préparé maintenant (sonde en parallèle), déclenché après Ctrl+V.
    // Abandonné sans déclenchement si le collage échoue plus bas.
    #[cfg(windows)]
    let launch = match (animate.unwrap_or(false), target) {
        (true, Some(hwnd)) => fx::prepare(&app, orb_hwnd(&app), hwnd, chars),
        _ => None,
    };
    #[cfg(not(windows))]
    let _ = chars;

    // Laisse le focus + le presse-papier se stabiliser avant le collage.
    thread::sleep(Duration::from_millis(60));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    // Libère d'éventuels modificateurs résiduels (push-to-talk) pour ne pas polluer le Ctrl+V.
    let _ = enigo.key(Key::Shift, Release);
    let _ = enigo.key(Key::Alt, Release);
    enigo.key(Key::Control, Press).map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('v'), Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Control, Release)
        .map_err(|e| e.to_string())?;

    #[cfg(windows)]
    if let Some(launch) = launch {
        launch.go();
    }
    Ok(())
}

/// Rectangle en pixels physiques de l'écran (aperçu de l'effet « livraison »).
#[derive(Deserialize)]
struct ScreenRect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

/// Aperçu de l'effet « livraison » (Réglages) : la comète part de l'orbe flottante et
/// illumine les lignes données — celles d'un texte de démonstration dans la fenêtre.
#[tauri::command]
fn preview_delivery(app: AppHandle, lines: Vec<ScreenRect>) {
    #[cfg(windows)]
    {
        let lines = lines
            .into_iter()
            .map(|r| delivery::Rect::new(r.x, r.y, r.w, r.h))
            .collect();
        fx::preview(&app, orb_hwnd(&app), lines);
    }
    #[cfg(not(windows))]
    let _ = (app, lines);
}

/// Label de la fenêtre principale.
const MAIN_LABEL: &str = "main";

/// Affiche (et focalise) ou cache la fenêtre principale, et prévient la page : cacher une
/// fenêtre Tauri ne met PAS la page WebView2 en pause, c'est elle qui coupe ses animations.
fn set_main_visible(app: &AppHandle, visible: bool) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        if visible {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        } else {
            let _ = window.hide();
        }
        let _ = app.emit_to(
            MAIN_LABEL,
            orb::WINDOW_VISIBILITY_EVENT,
            orb::WindowVisibility {
                label: "main",
                visible,
            },
        );
    }
}

/// Affiche et donne le focus à la fenêtre principale (clic sur l'orbe flottante).
#[tauri::command]
fn show_main(app: AppHandle) {
    set_main_visible(&app, true);
}

/// Affiche / masque l'orbe flottante sans voler le focus (mode « pendant la dictée »).
#[tauri::command]
fn set_orb_visible(app: AppHandle, visible: bool) {
    orb::set_visible(&app, visible);
}

/// Replace l'orbe en bas au centre de l'écran principal.
#[tauri::command]
fn reset_orb_position(app: AppHandle) {
    orb::reset_position(&app);
}

/// Dernier état affiché par le tray (évite de redessiner l'icône pour rien).
struct TrayState {
    last: Mutex<String>,
}

const TRAY_ID: &str = "main";
const TRAY_ICON_IDLE: &[u8] = include_bytes!("../icons/tray-idle.png");
const TRAY_ICON_LIVE: &[u8] = include_bytes!("../icons/tray-live.png");

/// Reflète l'état de la dictée dans le tray (infobulle + icône allumée pendant l'écoute).
#[tauri::command]
fn set_tray_state(app: AppHandle, tray: tauri::State<'_, TrayState>, state: String) {
    let live = matches!(state.as_str(), "listening" | "transcribing");
    let tooltip = match state.as_str() {
        "listening" => "Asas Voice — à l'écoute",
        "transcribing" => "Asas Voice — transcription…",
        _ => "Asas Voice — prêt",
    };
    if let Ok(mut last) = tray.last.lock() {
        if *last == tooltip {
            return;
        }
        *last = tooltip.to_string();
    }
    if let Some(icon) = app.tray_by_id(TRAY_ID) {
        let _ = icon.set_tooltip(Some(tooltip));
        let bytes = if live { TRAY_ICON_LIVE } else { TRAY_ICON_IDLE };
        if let Ok(image) = tauri::image::Image::from_bytes(bytes) {
            let _ = icon.set_icon(Some(image));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migrations SQLite : historique des dictées (T6) + épinglage (Phase 1, P2.3).
    let migrations = vec![
        Migration {
            version: 1,
            description: "create dictations table",
            sql: "CREATE TABLE IF NOT EXISTS dictations (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, duration_sec REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add pinned column",
            sql: "ALTER TABLE dictations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
    ];

    let builder = tauri::Builder::default();

    // Single-instance : un seul process Asas Voice à la fois. Toute tentative de second
    // lancement (double-clic, autostart) réveille la fenêtre existante au lieu
    // d'empiler des process invisibles dans le tray. DOIT précéder les autres plugins.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        set_main_visible(app, true);
    }));

    let builder = builder
        .manage(DictationState {
            target: Mutex::new(None),
        })
        .manage(BackendState {
            child: Mutex::new(None),
        })
        .manage(orb::OrbState::new())
        .manage(TrayState {
            last: Mutex::new("Asas Voice — prêt".into()),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:asasvoice.db", migrations)
                .build(),
        );

    // Plugins desktop : raccourci global push-to-talk + démarrage au boot.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Au démarrage de Windows, Asas Voice se lance réduite dans le tray (l'orbe et le
        // raccourci sont prêts, sans fenêtre qui surgit).
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![START_MINIMIZED_ARG]),
        ));

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::{
                    menu::{Menu, MenuItem, PredefinedMenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                };

                // Tray : clic gauche = ouvrir Asas Voice ; clic droit = menu.
                let show = MenuItem::with_id(app, "show", "Ouvrir Asas Voice", true, None::<&str>)?;
                let recenter =
                    MenuItem::with_id(app, "recenter", "Recentrer l'orbe", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &recenter, &separator, &quit])?;
                let idle_icon = tauri::image::Image::from_bytes(TRAY_ICON_IDLE)?;

                TrayIconBuilder::with_id(TRAY_ID)
                    .icon(idle_icon)
                    .tooltip("Asas Voice — prêt")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => set_main_visible(app, true),
                        "recenter" => orb::reset_position(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            set_main_visible(tray.app_handle(), true);
                        }
                    })
                    .build(app)?;

                // Fenêtre orbe flottante — créée après le tray.
                orb::spawn(app.handle())?;

                // Fenêtre principale : créée cachée (tauri.conf.json) pour qu'un lancement
                // au démarrage de Windows ne la fasse pas surgir ; affichée sinon.
                let start_minimized = std::env::args().any(|a| a == START_MINIMIZED_ARG);
                set_main_visible(app.handle(), !start_minimized);

                // L'entrée « démarrage auto » d'une version précédente n'a pas l'argument
                // de lancement réduit : on la réécrit. Uniquement en build installé (en dev,
                // cela ferait pointer le démarrage auto vers l'exe de développement).
                #[cfg(not(debug_assertions))]
                {
                    use tauri_plugin_autostart::ManagerExt;
                    let launcher = app.autolaunch();
                    if launcher.is_enabled().unwrap_or(false) {
                        let _ = launcher.enable();
                    }
                }

                // Backend Fastify embarqué (Jalon A) : lancé au démarrage avec la clé du
                // trousseau OS. En dev, si un backend tourne déjà (pnpm dev:backend), on
                // ne le double pas. Sans clé, /transcribe répond une erreur claire jusqu'à
                // ce que l'onboarding la renseigne (qui relance alors le backend).
                let handle = app.handle().clone();
                let backend = app.state::<BackendState>();
                spawn_backend(&handle, backend.inner());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenêtre PRINCIPALE = la masquer dans le tray (le raccourci global
            // reste actif). L'orbe, elle, ne se ferme pas (pas de décorations).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_LABEL {
                    api.prevent_close();
                    set_main_visible(window.app_handle(), false);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            copy_text,
            paste_text,
            capture_target,
            show_main,
            api_key_is_set,
            set_api_key,
            clear_api_key,
            anthropic_key_is_set,
            set_anthropic_key,
            clear_anthropic_key,
            restart_backend,
            save_text_file,
            set_orb_visible,
            reset_orb_position,
            set_tray_state,
            preview_delivery
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // À l'extinction de l'app, on tue le backend qu'on a lancé (sinon il survit
            // au process et garde le port 4321).
            if let tauri::RunEvent::Exit = event {
                if let Some(backend) = app_handle.try_state::<BackendState>() {
                    kill_backend(backend.inner());
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::save_text_file;

    #[test]
    fn save_text_file_ecrit_le_contenu() {
        let mut path = std::env::temp_dir();
        path.push(format!("asas-voice-test-{}.txt", std::process::id()));
        let path_str = path.to_string_lossy().to_string();

        save_text_file(path_str, "coucou\néléphant".into()).expect("écriture");
        let read = std::fs::read_to_string(&path).expect("relecture");
        assert_eq!(read, "coucou\néléphant");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_text_file_echoue_proprement_si_dossier_absent() {
        let mut path = std::env::temp_dir();
        path.push("asas-voice-dossier-inexistant-xyz");
        path.push("fichier.txt"); // le dossier parent n'existe pas
        let res = save_text_file(path.to_string_lossy().to_string(), "x".into());
        assert!(res.is_err()); // erreur String, pas de panic
    }
}
