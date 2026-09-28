"""
Génère l'identité iconographique d'Asas Voice (SVG sources) :

  asas-voice-icon.svg        icône maître 1024 px (fond encre + orbe-instrument)
  asas-voice-icon-small.svg  variante simplifiée lisible à 16-32 px
  asas-voice-mark.svg        marque seule (orbe + anneau), fond transparent
  tray-idle.svg / tray-live.svg  icônes de zone de notification (repos / écoute)

L'icône EST l'orbe de l'app : cœur liquide spectral (pêche → violet) éclairé en haut à
gauche, liseré net, et anneau de 60 graduations dont l'arc du bas s'allume comme un
spectre de voix (graves en bas — même lecture que l'orbe animée).

Rendu PNG / ICO : voir render.mjs (Edge headless) — `node design/icon/render.mjs`.
"""

import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TAU = math.tau

CORE_STOPS = [(0, "#fff3e4"), (0.22, "#ffb088"), (0.52, "#e07fc4"), (0.78, "#9a66ff"), (1, "#3f2ea6")]


def core_path(cx, cy, r, wobble=True):
    """Contour du cœur : un cercle très légèrement liquide (harmoniques figées)."""
    pts = []
    n = 96
    for i in range(n):
        a = i / n * TAU
        k = 1.0
        if wobble:
            k += 0.007 * math.sin(3 * a + 0.7) + 0.004 * math.sin(5 * a - 1.2)
        pts.append((cx + math.cos(a) * r * k, cy + math.sin(a) * r * k))
    # Courbe lissée par milieux (identique au rendu canvas de l'app).
    mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
    d = []
    m0 = mid(pts[-1], pts[0])
    d.append(f"M{m0[0]:.2f},{m0[1]:.2f}")
    for i in range(n):
        p = pts[i]
        q = pts[(i + 1) % n]
        m = mid(p, q)
        d.append(f"Q{p[0]:.2f},{p[1]:.2f} {m[0]:.2f},{m[1]:.2f}")
    d.append("Z")
    return " ".join(d)


def spectral_light(angle):
    """Lumière d'une graduation : arc du bas allumé comme un spectre de voix."""
    # 0 en bas, 1 en haut (symétrique), comme spectralPosition() côté app.
    u = ((angle + math.pi / 2) % TAU) / TAU
    from_top = u * 2 if u <= 0.5 else (1 - u) * 2
    pos = 1 - from_top  # 0 = bas
    if pos > 0.42:
        return 0.0
    # Enveloppe de voix : forte sur les graves, qui décroît vers les côtés, avec un relief.
    env = math.cos(pos / 0.42 * math.pi / 2) ** 1.3
    relief = 0.72 + 0.28 * math.sin(pos * 38 + 0.8)
    return max(0.0, min(1.0, env * relief))


def gradient_defs(prefix, cx, cy, r):
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in CORE_STOPS)
    fx = cx - r * 0.3
    fy = cy - r * 0.36
    return f"""
    <radialGradient id="{prefix}core" gradientUnits="userSpaceOnUse" cx="{cx + r * 0.06:.2f}" cy="{cy + r * 0.08:.2f}" r="{r * 1.14:.2f}" fx="{fx:.2f}" fy="{fy:.2f}" fr="{r * 0.02:.2f}">{stops}</radialGradient>
    <linearGradient id="{prefix}rim" gradientUnits="userSpaceOnUse" x1="{cx - r}" y1="{cy - r}" x2="{cx + r}" y2="{cy + r}">
      <stop offset="0" stop-color="#fff0e2" stop-opacity="0.42"/>
      <stop offset="0.5" stop-color="#fff0e2" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#1a1030" stop-opacity="0.25"/>
    </linearGradient>
    <radialGradient id="{prefix}spec" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fffaf2" stop-opacity="0.7"/>
      <stop offset="0.5" stop-color="#fff6ec" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#fff6ec" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="{prefix}aura" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{r * 2.5:.2f}">
      <stop offset="0" stop-color="#ffa47a" stop-opacity="0.34"/>
      <stop offset="0.32" stop-color="#d678dc" stop-opacity="0.18"/>
      <stop offset="0.6" stop-color="#9664ff" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#9664ff" stop-opacity="0"/>
    </radialGradient>"""


def orb_group(prefix, cx, cy, r, ticks=True, ring_lit=True, tick_scale=1.0, solid_ring=False,
              ring_idle="#c4baff", ring_hot="#ffc49e", idle_alpha=0.3, aura=True):
    parts = []
    if aura:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r * 2.5:.2f}" fill="url(#{prefix}aura)"/>')
    ring_r = r * 1.55
    if solid_ring:
        # Petites tailles : un anneau fin continu + un arc chaud en bas (lisible à 16 px).
        sw = r * 0.16
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{ring_r:.2f}" fill="none" stroke="{ring_idle}" '
            f'stroke-opacity="{idle_alpha + 0.15}" stroke-width="{sw:.2f}"/>'
        )
        if ring_lit:
            a0 = math.pi / 2 - 0.95
            a1 = math.pi / 2 + 0.95
            x0, y0 = cx + math.cos(a0) * ring_r, cy + math.sin(a0) * ring_r
            x1, y1 = cx + math.cos(a1) * ring_r, cy + math.sin(a1) * ring_r
            parts.append(
                f'<path d="M{x0:.2f},{y0:.2f} A{ring_r:.2f},{ring_r:.2f} 0 0 1 {x1:.2f},{y1:.2f}" '
                f'fill="none" stroke="{ring_hot}" stroke-width="{sw * 1.25:.2f}" stroke-linecap="round"/>'
            )
    elif ticks:
        unit = r / 22 * tick_scale
        lw = max(1.0, r * 0.058)
        for j in range(60):
            a = -math.pi / 2 + j / 60 * TAU
            light = spectral_light(a) if ring_lit else 0.0
            cardinal = j % 15 == 0
            length = ((4 if cardinal else 2.2) + light * 8.5) * unit
            x0, y0 = cx + math.cos(a) * ring_r, cy + math.sin(a) * ring_r
            x1, y1 = cx + math.cos(a) * (ring_r + length), cy + math.sin(a) * (ring_r + length)
            if light > 0.02:
                color, alpha = ring_hot, 0.35 + 0.65 * light
            else:
                color, alpha = ring_idle, idle_alpha + (0.2 if cardinal else 0)
            parts.append(
                f'<line x1="{x0:.2f}" y1="{y0:.2f}" x2="{x1:.2f}" y2="{y1:.2f}" stroke="{color}" '
                f'stroke-opacity="{alpha:.3f}" stroke-width="{lw:.2f}" stroke-linecap="round"/>'
            )
    d = core_path(cx, cy, r)
    parts.append(f'<path d="{d}" fill="url(#{prefix}core)"/>')
    parts.append(
        f'<path d="{d}" fill="none" stroke="url(#{prefix}rim)" stroke-width="{max(0.6, r * 0.03):.2f}"/>'
    )
    sx, sy = cx - r * 0.36, cy - r * 0.44
    parts.append(
        f'<ellipse cx="{sx:.2f}" cy="{sy:.2f}" rx="{r * 0.39:.2f}" ry="{r * 0.25:.2f}" '
        f'transform="rotate(-28.6 {sx:.2f} {sy:.2f})" fill="url(#{prefix}spec)"/>'
    )
    return "\n  ".join(parts)


def squircle_path(size, inset, radius_ratio=0.235):
    """Carré à coins continus (approximation superellipse par courbes de Bézier)."""
    x0, y0 = inset, inset
    x1, y1 = size - inset, size - inset
    r = (x1 - x0) * radius_ratio
    k = r * 0.2  # coins « continus » : la courbe commence plus tôt qu'un arc
    c = 0.62
    return (
        f"M{x0 + r + k:.1f},{y0} H{x1 - r - k:.1f} "
        f"C{x1 - r * (1 - c):.1f},{y0} {x1},{y0 + r * (1 - c):.1f} {x1},{y0 + r + k:.1f} "
        f"V{y1 - r - k:.1f} "
        f"C{x1},{y1 - r * (1 - c):.1f} {x1 - r * (1 - c):.1f},{y1} {x1 - r - k:.1f},{y1} "
        f"H{x0 + r + k:.1f} "
        f"C{x0 + r * (1 - c):.1f},{y1} {x0},{y1 - r * (1 - c):.1f} {x0},{y1 - r - k:.1f} "
        f"V{y0 + r + k:.1f} "
        f"C{x0},{y0 + r * (1 - c):.1f} {x0 + r * (1 - c):.1f},{y0} {x0 + r + k:.1f},{y0} Z"
    )


def background_defs(size):
    return f"""
    <radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="{size * 0.5}" cy="{size * 0.28}" r="{size * 0.85}">
      <stop offset="0" stop-color="#231a3d"/>
      <stop offset="0.55" stop-color="#130f20"/>
      <stop offset="1" stop-color="#0a0910"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.02"/>
    </linearGradient>"""


def write(name, svg):
    with open(os.path.join(HERE, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(svg)
    print("écrit", name)


def app_icon(size=1024, small=False):
    inset = size * (0.045 if not small else 0.02)
    sq = squircle_path(size, inset)
    cx = cy = size / 2
    r = size * (0.178 if not small else 0.215)
    orb = orb_group("o", cx, cy, r, ticks=not small, solid_ring=small, tick_scale=1.0,
                    idle_alpha=0.3 if not small else 0.35, aura=True)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <defs>{background_defs(size)}{gradient_defs("o", cx, cy, r)}
    <clipPath id="sq"><path d="{sq}"/></clipPath>
  </defs>
  <path d="{sq}" fill="url(#bg)"/>
  <g clip-path="url(#sq)">
  {orb}
  </g>
  <path d="{sq}" fill="none" stroke="url(#edge)" stroke-width="{max(1, size * 0.004):.2f}"/>
</svg>
"""


def mark(size=256):
    cx = cy = size / 2
    r = size * 0.2
    orb = orb_group("m", cx, cy, r, ticks=True, aura=False, idle_alpha=0.34)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <defs>{gradient_defs("m", cx, cy, r)}</defs>
  {orb}
</svg>
"""


def tray(live, size=32):
    """Tray : orbe plus grande (lisible à 16 px) ; en écoute, tout l'anneau s'allume."""
    cx = cy = size / 2
    r = size * 0.28
    orb = orb_group("t", cx, cy, r, ticks=False, solid_ring=True, ring_lit=live, aura=False,
                    ring_idle="#ffc49e" if live else "#b9adf5",
                    idle_alpha=0.85 if live else 0.5)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <defs>{gradient_defs("t", cx, cy, r)}</defs>
  {orb}
</svg>
"""


if __name__ == "__main__":
    write("asas-voice-icon.svg", app_icon(1024))
    write("asas-voice-icon-small.svg", app_icon(256, small=True))
    write("asas-voice-mark.svg", mark(256))
    write("tray-idle.svg", tray(False))
    write("tray-live.svg", tray(True))
