//! Sonde du texte au curseur dans l'application cible (Windows).
//!
//! Trois sources, de la plus légère à la plus précise :
//!  1. le caret système (`GetGUIThreadInfo`) — Bloc-notes classique, Notepad++, Office… ;
//!  2. l'objet MSAA `OBJID_CARET` exposé par l'application — Chrome, Edge, Firefox,
//!     applications Electron ;
//!  3. UI Automation — le seul qui décrit le TEXTE lui-même : les rectangles, ligne par
//!     ligne, de ce qui vient d'être collé (Word, nouveau Bloc-notes, navigateurs…).
//!
//! Tout se passe sur un fil dédié à l'effet : le collage n'attend jamais la sonde. Les
//! appels inter-process sont bornés (SendMessageTimeout, délais UI Automation) : une
//! application figée ne peut pas bloquer Asas Voice.
//!
//! Toutes les coordonnées renvoyées sont en pixels PHYSIQUES du bureau.

use crate::delivery::Rect;
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    SAFEARRAY,
};
use windows::Win32::System::Ole::{
    SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound,
    SafeArrayUnaccessData,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, CUIAutomation8, IAccessible, IUIAutomation, IUIAutomation2,
    IUIAutomationElement, IUIAutomationTextPattern, IUIAutomationTextPattern2,
    IUIAutomationTextRange, ObjectFromLresult, TextPatternRangeEndpoint_End,
    TextPatternRangeEndpoint_Start, TextUnit_Character, UIA_TextPattern2Id, UIA_TextPatternId,
};
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::UI::HiDpi::{
    GetWindowDpiAwarenessContext, LogicalToPhysicalPointForPerMonitorDPI,
    SetThreadDpiAwarenessContext,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetClientRect, GetGUIThreadInfo, GetWindowRect, GetWindowThreadProcessId,
    IsHungAppWindow, SendMessageTimeoutW, GUITHREADINFO, SMTO_ABORTIFHUNG, SMTO_BLOCK,
    WM_GETOBJECT,
};

/// Identifiant MSAA du caret (OBJID_CARET = -8), passé en LPARAM comme un DWORD.
const OBJID_CARET: i32 = -8;
/// Délai max d'une requête UI Automation / MSAA vers l'application cible (ms).
const CALL_TIMEOUT_MS: u32 = 250;

/// Session de sonde : COM initialisé sur le fil courant + client UI Automation.
pub struct Probe {
    uia: Option<IUIAutomation>,
    com: bool,
}

impl Probe {
    /// À créer sur le fil qui sondera (COM est par fil).
    pub fn new() -> Self {
        let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
        let uia = unsafe {
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                .or_else(|_| CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER))
                .ok()
        };
        if let Some(uia2) = uia.as_ref().and_then(|u| u.cast::<IUIAutomation2>().ok()) {
            unsafe {
                let _ = uia2.SetConnectionTimeout(CALL_TIMEOUT_MS);
                let _ = uia2.SetTransactionTimeout(CALL_TIMEOUT_MS);
            }
        }
        Self { uia, com }
    }

    /// Position du caret dans la fenêtre cible (rectangle fin, hauteur de ligne).
    pub fn caret(&self, target: isize) -> Option<Rect> {
        let target = target as HWND;
        if target.is_null() || unsafe { IsHungAppWindow(target) } != 0 {
            return None;
        }
        let gti = gui_thread_info(target);
        if let Some(r) = gti.as_ref().and_then(system_caret) {
            return Some(r);
        }
        let focus = gti
            .map(|g| g.hwndFocus)
            .filter(|h| !h.is_null())
            .unwrap_or(target);
        if let Some(r) = msaa_caret(focus) {
            return Some(r);
        }
        self.uia_caret(target)
    }

    /// Rectangles (ligne par ligne) des `chars` caractères qui précèdent le curseur :
    /// juste après un collage, c'est exactement le texte qui vient d'arriver.
    /// Renvoie aussi le caret de fin (pour vérifier que le collage a bien eu lieu).
    pub fn inserted_text(&self, target: isize, chars: usize) -> Option<(Vec<Rect>, Rect)> {
        let (range, _) = self.focused_caret_range(target as HWND)?;
        unsafe {
            let end = caret_of_range(&range)?;
            let inserted = range.Clone().ok()?;
            let count = i32::try_from(chars).unwrap_or(i32::MAX);
            inserted
                .MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -count)
                .ok()?;
            let rects = bounding_rects(&inserted)?;
            Some((rects, end))
        }
    }

    /// Bords du champ de saisie qui a le focus (pour approximer un texte multiligne).
    pub fn field_bounds(&self, target: isize) -> Option<Rect> {
        let target = target as HWND;
        if let Some(el) = self.focused_element_of(target) {
            if let Ok(r) = unsafe { el.CurrentBoundingRectangle() } {
                let rect = Rect::new(
                    r.left as f32,
                    r.top as f32,
                    (r.right - r.left) as f32,
                    (r.bottom - r.top) as f32,
                );
                if rect.w > 8.0 && rect.h > 8.0 {
                    return Some(rect);
                }
            }
        }
        // Repli : la fenêtre enfant qui a le focus, si c'est un vrai contrôle de saisie (pas
        // la surface entière d'un navigateur).
        let focus = gui_thread_info(target)?.hwndFocus;
        if focus.is_null() || is_browser_surface(focus) {
            return None;
        }
        let mut rc = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetClientRect(focus, &mut rc) } == 0 {
            return None;
        }
        client_rect_to_screen(focus, rc)
    }

    // -------------------------------------------------------------- UI Automation

    /// Élément qui a le focus, s'il appartient bien à l'application cible.
    fn focused_element_of(&self, target: HWND) -> Option<IUIAutomationElement> {
        let uia = self.uia.as_ref()?;
        let el = unsafe { uia.GetFocusedElement() }.ok()?;
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(target, &mut pid) };
        let el_pid = unsafe { el.CurrentProcessId() }.ok()?;
        (pid != 0 && el_pid as u32 == pid).then_some(el)
    }

    /// Plage dégénérée au caret (TextPattern2), sinon fin de la sélection (TextPattern).
    fn focused_caret_range(&self, target: HWND) -> Option<(IUIAutomationTextRange, bool)> {
        let el = self.focused_element_of(target)?;
        unsafe {
            if let Ok(tp2) = el.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
            {
                let mut active = windows::core::BOOL(0);
                if let Ok(range) = tp2.GetCaretRange(&mut active) {
                    return Some((range, active.as_bool()));
                }
            }
            let tp = el
                .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                .ok()?;
            let selection = tp.GetSelection().ok()?;
            if selection.Length().ok()? < 1 {
                return None;
            }
            let range = selection.GetElement(0).ok()?;
            // Réduit la sélection à sa fin (là où le texte collé se termine).
            let end = range.Clone().ok()?;
            end.MoveEndpointByRange(
                TextPatternRangeEndpoint_Start,
                &range,
                TextPatternRangeEndpoint_End,
            )
            .ok()?;
            Some((end, true))
        }
    }

    fn uia_caret(&self, target: HWND) -> Option<Rect> {
        let (range, _) = self.focused_caret_range(target)?;
        unsafe { caret_of_range(&range) }
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        self.uia = None; // libère le client UI Automation AVANT CoUninitialize
        if self.com {
            unsafe { CoUninitialize() };
        }
    }
}

/// Caret d'une plage dégénérée : ses rectangles sont souvent vides, on mesure donc le
/// caractère suivant (bord gauche) ou, en fin de texte, le précédent (bord droit).
unsafe fn caret_of_range(range: &IUIAutomationTextRange) -> Option<Rect> {
    if let Some(r) = bounding_rects(range).and_then(|v| v.last().copied()) {
        return Some(Rect::new(r.right(), r.y, 2.0, r.h));
    }
    let next = range.Clone().ok()?;
    if next
        .MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, 1)
        .ok()?
        == 1
    {
        if let Some(r) = bounding_rects(&next).and_then(|v| v.first().copied()) {
            return Some(Rect::new(r.x, r.y, 2.0, r.h));
        }
    }
    let prev = range.Clone().ok()?;
    if prev
        .MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -1)
        .ok()?
        == -1
    {
        if let Some(r) = bounding_rects(&prev).and_then(|v| v.last().copied()) {
            return Some(Rect::new(r.right(), r.y, 2.0, r.h));
        }
    }
    None
}

/// Rectangles d'une plage de texte (tableau de doubles : x, y, largeur, hauteur…).
unsafe fn bounding_rects(range: &IUIAutomationTextRange) -> Option<Vec<Rect>> {
    let array: *mut SAFEARRAY = range.GetBoundingRectangles().ok()?;
    if array.is_null() {
        return None;
    }
    let mut out = Vec::new();
    let lo = SafeArrayGetLBound(array, 1).unwrap_or(0);
    let hi = SafeArrayGetUBound(array, 1).unwrap_or(-1);
    let count = (hi - lo + 1).max(0) as usize;
    let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
    if count >= 4 && SafeArrayAccessData(array, &mut data).is_ok() && !data.is_null() {
        let values = std::slice::from_raw_parts(data as *const f64, count);
        for q in values.as_chunks::<4>().0 {
            out.push(Rect::new(
                q[0] as f32,
                q[1] as f32,
                q[2] as f32,
                q[3] as f32,
            ));
        }
        let _ = SafeArrayUnaccessData(array);
    }
    let _ = SafeArrayDestroy(array);
    (!out.is_empty()).then_some(out)
}

// ------------------------------------------------------------------ Win32 / MSAA

fn gui_thread_info(target: HWND) -> Option<GUITHREADINFO> {
    unsafe {
        let thread = GetWindowThreadProcessId(target, std::ptr::null_mut());
        if thread == 0 {
            return None;
        }
        let mut gti: GUITHREADINFO = std::mem::zeroed();
        gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        (GetGUIThreadInfo(thread, &mut gti) != 0).then_some(gti)
    }
}

/// Caret système (CreateCaret/SetCaretPos) de l'application cible.
fn system_caret(gti: &GUITHREADINFO) -> Option<Rect> {
    let rc = gti.rcCaret;
    if gti.hwndCaret.is_null() || rc.bottom - rc.top <= 0 {
        return None;
    }
    let mut screen = client_rect_to_screen(gti.hwndCaret, rc)?;
    screen.w = screen.w.max(2.0);
    Some(screen)
}

/// Caret exposé en MSAA par l'application elle-même (Chromium, Firefox). On n'utilise PAS
/// le proxy système d'oleacc (il relirait le caret système, déjà essayé) : seulement la
/// réponse native à WM_GETOBJECT, obtenue avec un délai borné.
fn msaa_caret(hwnd: HWND) -> Option<Rect> {
    unsafe {
        let mut result: usize = 0;
        let ok = SendMessageTimeoutW(
            hwnd,
            WM_GETOBJECT,
            0,
            OBJID_CARET as u32 as isize,
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            CALL_TIMEOUT_MS,
            &mut result,
        );
        if ok == 0 || result == 0 {
            return None;
        }
        let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        ObjectFromLresult(
            windows::Win32::Foundation::LRESULT(result as isize),
            &IAccessible::IID,
            windows::Win32::Foundation::WPARAM(0),
            &mut ptr,
        )
        .ok()?;
        if ptr.is_null() {
            return None;
        }
        let acc = IAccessible::from_raw(ptr);
        let (mut l, mut t, mut w, mut h) = (0, 0, 0, 0);
        acc.accLocation(&mut l, &mut t, &mut w, &mut h, &VARIANT::from(0i32))
            .ok()?;
        (h > 0 && (l != 0 || t != 0))
            .then(|| Rect::new(l as f32, t as f32, w.max(2) as f32, h as f32))
    }
}

/// Rectangle client → écran, en pixels physiques, quelle que soit la gestion du DPI de
/// l'application cible (une application « DPI-unaware » est virtualisée par Windows).
fn client_rect_to_screen(hwnd: HWND, rc: RECT) -> Option<Rect> {
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    unsafe {
        let mut a = POINT {
            x: rc.left,
            y: rc.top,
        };
        let mut b = POINT {
            x: rc.right,
            y: rc.bottom,
        };
        let ctx = GetWindowDpiAwarenessContext(hwnd);
        let previous = if ctx.is_null() {
            std::ptr::null_mut()
        } else {
            SetThreadDpiAwarenessContext(ctx)
        };
        let ok = ClientToScreen(hwnd, &mut a) != 0 && ClientToScreen(hwnd, &mut b) != 0;
        if !previous.is_null() {
            SetThreadDpiAwarenessContext(previous);
        }
        if !ok {
            return None;
        }
        LogicalToPhysicalPointForPerMonitorDPI(hwnd, &mut a);
        LogicalToPhysicalPointForPerMonitorDPI(hwnd, &mut b);
        Some(Rect::new(
            a.x as f32,
            a.y as f32,
            (b.x - a.x) as f32,
            (b.y - a.y) as f32,
        ))
    }
}

/// Surface de rendu d'un navigateur : sa zone client est toute la page, pas le champ.
fn is_browser_surface(hwnd: HWND) -> bool {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
    class.starts_with("Chrome_") || class.starts_with("Mozilla") || class.contains("WebView")
}

/// Rectangle de la fenêtre cible (pixels physiques) — sert à rogner les rectangles lus.
pub fn window_bounds(target: isize) -> Option<Rect> {
    let mut rc = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    (unsafe { GetWindowRect(target as HWND, &mut rc) } != 0).then(|| {
        Rect::new(
            rc.left as f32,
            rc.top as f32,
            (rc.right - rc.left) as f32,
            (rc.bottom - rc.top) as f32,
        )
    })
}
