//! Géométrie et chronologie de l'effet « livraison » (pur, sans Win32, testé).
//!
//! Quand une dictée est collée au curseur, l'orbe lance une comète vers l'endroit où le
//! texte vient d'arriver, puis le texte s'illumine en violet, ligne par ligne, avant de
//! s'effacer. Ce module décrit OÙ (lignes de texte, trajectoire) et QUAND (durées,
//! courbes) ; `fx.rs` dessine, `caret.rs` interroge l'application cible.
//!
//! Toutes les coordonnées sont en pixels PHYSIQUES du bureau virtuel.

/// Rectangle en pixels physiques (flottants : les rectangles UI Automation le sont).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
    pub fn right(&self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }
    pub fn cy(&self) -> f32 {
        self.y + self.h / 2.0
    }
    /// Intersection (None si vide).
    pub fn intersect(&self, o: &Rect) -> Option<Rect> {
        let x = self.x.max(o.x);
        let y = self.y.max(o.y);
        let r = self.right().min(o.right());
        let b = self.bottom().min(o.bottom());
        (r > x && b > y).then(|| Rect::new(x, y, r - x, b - y))
    }
    pub fn union(&self, o: &Rect) -> Rect {
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Rect::new(
            x,
            y,
            self.right().max(o.right()) - x,
            self.bottom().max(o.bottom()) - y,
        )
    }
    pub fn inflate(&self, dx: f32, dy: f32) -> Rect {
        Rect::new(
            self.x - dx,
            self.y - dy,
            self.w + 2.0 * dx,
            self.h + 2.0 * dy,
        )
    }
    /// Recouvrement vertical relatif (0..1) par rapport à la plus petite hauteur.
    fn v_overlap(&self, o: &Rect) -> f32 {
        let top = self.y.max(o.y);
        let bot = self.bottom().min(o.bottom());
        ((bot - top).max(0.0)) / self.h.min(o.h).max(1.0)
    }
}

/// Au-delà, on ne surligne plus (un collage géant n'a pas besoin de 200 lignes violettes).
pub const MAX_LINES: usize = 40;

/// Nettoie les rectangles de texte renvoyés par l'application : écarte les absurdes,
/// rogne à la fenêtre cible, fusionne les fragments d'une même ligne, trie dans l'ordre
/// de lecture.
pub fn sanitize_lines(rects: &[Rect], bounds: Option<Rect>, scale: f32) -> Vec<Rect> {
    let max_h = 220.0 * scale.max(0.5);
    let mut out: Vec<Rect> = Vec::new();
    for r in rects {
        if !(r.x.is_finite() && r.y.is_finite() && r.w.is_finite() && r.h.is_finite()) {
            continue;
        }
        if r.h < 3.0 || r.h > max_h || r.w < 0.5 {
            continue;
        }
        let r = match bounds {
            Some(b) => match r.intersect(&b) {
                Some(c) => c,
                None => continue,
            },
            None => *r,
        };
        out.push(r);
    }
    out.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));
    // Fusion des fragments d'une même ligne (UI Automation renvoie parfois un rectangle
    // par « run » de mise en forme).
    let mut lines: Vec<Rect> = Vec::new();
    for r in out {
        match lines.iter_mut().find(|l| l.v_overlap(&r) > 0.5) {
            Some(line) => *line = line.union(&r),
            None => lines.push(r),
        }
    }
    lines.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    lines.truncate(MAX_LINES);
    lines
}

/// Prolonge la dernière ligne jusqu'au caret de fin : certaines applications rendent un
/// rectangle un peu court pour les derniers caractères, alors que le caret, lui, est
/// exactement à la fin du texte collé.
pub fn extend_to_caret(lines: &mut [Rect], end: &Rect) {
    if let Some(last) = lines.last_mut() {
        let same_line = (end.cy() - last.cy()).abs() < last.h.max(end.h) * 0.5;
        if same_line && end.x > last.right() && end.x - last.right() < last.h * 4.0 {
            last.w = end.x - last.x;
        }
    }
}

/// Vrai si le curseur a bougé entre avant et après le collage (sinon l'application n'a
/// pas encore traité Ctrl+V : les rectangles lus décriraient le texte d'AVANT).
pub fn caret_moved(pre: &Rect, post: &Rect) -> bool {
    (pre.x - post.x).abs() > 1.0 || (pre.cy() - post.cy()).abs() > 1.0
}

/// Lignes approximatives quand l'application ne décrit pas son texte (pas d'UI
/// Automation) mais qu'on connaît le curseur avant et après le collage.
///  - même ligne : du curseur de départ au curseur d'arrivée ;
///  - plusieurs lignes : il faut les bords du champ (`field`), sinon on renonce.
pub fn approx_lines(pre: &Rect, post: &Rect, field: Option<&Rect>) -> Vec<Rect> {
    let h = pre.h.max(post.h).max(4.0);
    if (pre.cy() - post.cy()).abs() < h * 0.5 {
        if post.x - pre.x < 1.0 {
            return Vec::new();
        }
        return vec![Rect::new(pre.x, pre.y.min(post.y), post.x - pre.x, h)];
    }
    let Some(field) = field else {
        return Vec::new();
    };
    if post.cy() < pre.cy() {
        return Vec::new(); // l'application a défilé ou réordonné : on ne devine pas.
    }
    let pad = (h * 0.25).min(8.0);
    let left = field.x + pad;
    let right = field.right() - pad;
    if right - left < 8.0 {
        return Vec::new();
    }
    let n = (((post.cy() - pre.cy()) / h).round() as usize + 1).clamp(2, MAX_LINES);
    let step = (post.cy() - pre.cy()) / (n - 1) as f32;
    (0..n)
        .filter_map(|i| {
            let cy = pre.cy() + step * i as f32;
            let x0 = if i == 0 { pre.x } else { left };
            let x1 = if i == n - 1 { post.x } else { right };
            (x1 - x0 >= 1.0).then(|| Rect::new(x0, cy - h / 2.0, x1 - x0, h))
        })
        .collect()
}

// ------------------------------------------------------------------ trajectoire

/// Trajectoire de la comète : une courbe de Bézier quadratique, bombée comme un lancer.
#[derive(Clone, Copy, Debug)]
pub struct Flight {
    pub s: (f32, f32),
    pub c: (f32, f32),
    pub e: (f32, f32),
}

impl Flight {
    /// Départ `s`, arrivée `e`. Le point de contrôle est décalé perpendiculairement,
    /// du côté « haut » de l'écran : la comète monte un peu avant de plonger.
    pub fn new(s: (f32, f32), e: (f32, f32)) -> Self {
        let (dx, dy) = (e.0 - s.0, e.1 - s.1);
        let dist = (dx * dx + dy * dy).sqrt().max(1.0);
        let (mut nx, mut ny) = (-dy / dist, dx / dist);
        if ny > 0.0 {
            nx = -nx;
            ny = -ny;
        }
        let bow = (dist * 0.2).min(220.0);
        let c = ((s.0 + e.0) / 2.0 + nx * bow, (s.1 + e.1) / 2.0 + ny * bow);
        Self { s, c, e }
    }

    pub fn point(&self, t: f32) -> (f32, f32) {
        let u = 1.0 - t;
        (
            u * u * self.s.0 + 2.0 * u * t * self.c.0 + t * t * self.e.0,
            u * u * self.s.1 + 2.0 * u * t * self.c.1 + t * t * self.e.1,
        )
    }

    pub fn length(&self) -> f32 {
        let mut len = 0.0;
        let mut prev = self.s;
        for i in 1..=24 {
            let p = self.point(i as f32 / 24.0);
            len += ((p.0 - prev.0).powi(2) + (p.1 - prev.1).powi(2)).sqrt();
            prev = p;
        }
        len
    }
}

/// Durée du vol (ms) : les longues traversées durent un peu plus, sans jamais traîner.
pub fn flight_ms(length_px: f32, scale: f32) -> f32 {
    let logical = length_px / scale.max(0.5);
    (250.0 + logical * 0.11).clamp(260.0, 440.0)
}

/// Durée du balayage violet sur le texte (ms).
pub fn sweep_ms(lines: usize) -> f32 {
    (300.0 + 55.0 * lines.saturating_sub(1) as f32).min(620.0)
}

/// Longueur totale du texte à balayer (somme des largeurs de lignes).
pub fn text_length(lines: &[Rect]) -> f32 {
    lines.iter().map(|l| l.w).sum()
}

/// Portion de chaque ligne révélée quand le balayage a parcouru `progress` pixels
/// (dans l'ordre de lecture). Renvoie (ligne tronquée, vrai si c'est le front).
pub fn revealed(lines: &[Rect], progress: f32) -> Vec<(Rect, bool)> {
    let mut left = progress;
    let mut out = Vec::new();
    for l in lines {
        if left <= 0.0 {
            break;
        }
        let w = l.w.min(left);
        left -= l.w;
        out.push((Rect::new(l.x, l.y, w, l.h), left < 0.0));
    }
    out
}

// ------------------------------------------------------------------ courbes

pub fn clamp01(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

/// Sortie douce (décélération) — l'arrivée de la comète, le balayage.
pub fn ease_out_cubic(t: f32) -> f32 {
    let u = 1.0 - clamp01(t);
    1.0 - u * u * u
}

/// Départ vif, arrivée posée : le vol (accélère hors de l'orbe, freine dans le texte).
pub fn ease_in_out_cubic(t: f32) -> f32 {
    let t = clamp01(t);
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragments_d_une_meme_ligne_fusionnes_et_tries() {
        let rects = [
            Rect::new(300.0, 140.0, 80.0, 18.0),
            Rect::new(100.0, 100.0, 50.0, 18.0),
            Rect::new(150.0, 101.0, 60.0, 17.0),
        ];
        let lines = sanitize_lines(&rects, None, 1.0);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], Rect::new(100.0, 100.0, 110.0, 18.0));
        assert_eq!(lines[1].y, 140.0);
    }

    #[test]
    fn rectangles_absurdes_ecartes_et_rognes() {
        let bounds = Rect::new(0.0, 0.0, 500.0, 400.0);
        let rects = [
            Rect::new(10.0, 10.0, 100.0, 1.0),      // trop fin
            Rect::new(10.0, 10.0, 100.0, 900.0),    // trop haut
            Rect::new(2000.0, 10.0, 100.0, 18.0),   // hors fenêtre
            Rect::new(450.0, 50.0, 200.0, 18.0),    // à cheval : rogné
            Rect::new(f32::NAN, 10.0, 100.0, 18.0), // invalide
        ];
        let lines = sanitize_lines(&rects, Some(bounds), 1.0);
        assert_eq!(lines, vec![Rect::new(450.0, 50.0, 50.0, 18.0)]);
    }

    #[test]
    fn approximation_sur_une_ligne() {
        let pre = Rect::new(100.0, 50.0, 2.0, 20.0);
        let post = Rect::new(260.0, 50.0, 2.0, 20.0);
        assert_eq!(
            approx_lines(&pre, &post, None),
            vec![Rect::new(100.0, 50.0, 160.0, 20.0)]
        );
    }

    #[test]
    fn approximation_multiligne_exige_le_champ() {
        let pre = Rect::new(300.0, 50.0, 2.0, 20.0);
        let post = Rect::new(120.0, 90.0, 2.0, 20.0);
        assert!(approx_lines(&pre, &post, None).is_empty());
        let field = Rect::new(80.0, 40.0, 400.0, 200.0);
        let lines = approx_lines(&pre, &post, Some(&field));
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].x, 300.0); // première ligne : depuis le curseur de départ
        assert!((lines[2].right() - 120.0).abs() < 0.01); // dernière : jusqu'au curseur d'arrivée
        assert!(lines[1].x < 100.0 && lines[1].right() > 460.0); // ligne pleine
    }

    #[test]
    fn derniere_ligne_prolongee_jusqu_au_caret() {
        let mut lines = vec![
            Rect::new(50.0, 100.0, 400.0, 20.0),
            Rect::new(50.0, 124.0, 90.0, 20.0),
        ];
        extend_to_caret(&mut lines, &Rect::new(158.0, 124.0, 2.0, 20.0));
        assert_eq!(lines[1].right(), 158.0);
        // Caret sur une autre ligne, ou très loin : on ne touche à rien.
        let before = lines.clone();
        extend_to_caret(&mut lines, &Rect::new(400.0, 300.0, 2.0, 20.0));
        extend_to_caret(&mut lines, &Rect::new(900.0, 124.0, 2.0, 20.0));
        assert_eq!(lines, before);
    }

    #[test]
    fn curseur_immobile_detecte() {
        let pre = Rect::new(100.0, 50.0, 2.0, 20.0);
        assert!(!caret_moved(&pre, &Rect::new(100.4, 50.0, 2.0, 20.0)));
        assert!(caret_moved(&pre, &Rect::new(140.0, 50.0, 2.0, 20.0)));
    }

    #[test]
    fn trajectoire_part_de_l_orbe_et_arrive_au_texte() {
        let f = Flight::new((500.0, 900.0), (200.0, 300.0));
        assert_eq!(f.point(0.0), (500.0, 900.0));
        assert_eq!(f.point(1.0), (200.0, 300.0));
        // Bombée vers le haut de l'écran (y plus petit que la corde au milieu).
        assert!(f.point(0.5).1 < 600.0);
        assert!(f.length() > 670.0);
    }

    #[test]
    fn duree_de_vol_bornee() {
        assert_eq!(flight_ms(10.0, 1.0), 260.0);
        assert_eq!(flight_ms(10_000.0, 1.0), 440.0);
        assert!(flight_ms(1000.0, 1.0) > flight_ms(1000.0, 2.0));
    }

    #[test]
    fn balayage_dans_l_ordre_de_lecture() {
        let lines = [
            Rect::new(0.0, 0.0, 100.0, 10.0),
            Rect::new(0.0, 20.0, 50.0, 10.0),
        ];
        assert_eq!(text_length(&lines), 150.0);
        let r = revealed(&lines, 120.0);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0], (Rect::new(0.0, 0.0, 100.0, 10.0), false));
        assert_eq!(r[1], (Rect::new(0.0, 20.0, 20.0, 10.0), true));
        assert!(revealed(&lines, 0.0).is_empty());
    }

    #[test]
    fn courbes_aux_bornes() {
        for f in [ease_out_cubic, ease_in_out_cubic] {
            assert_eq!(f(0.0), 0.0);
            assert_eq!(f(1.0), 1.0);
            assert!(f(0.5) > 0.0 && f(0.5) < 1.0);
        }
    }
}
