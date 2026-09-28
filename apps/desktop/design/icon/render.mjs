// Rastérise les SVG de design/icon en PNG (Microsoft Edge headless, fond transparent),
// puis assemble icon.ico (PNG embarqués : variante simplifiée pour 16-32 px, maître au-delà)
// et le master PNG 1024 utilisé par `tauri icon` pour les autres formats.
//
//   python design/icon/generate.py && node design/icon/render.mjs
//
// Sorties : design/icon/out/*.png, src-tauri/icons/{icon.ico, tray-idle.png, tray-live.png},
// public/logo.png, design/asas-voice-icon-master.png.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "..", "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!EDGE) throw new Error("Microsoft Edge introuvable (nécessaire pour rastériser les SVG).");

/** Rend `svg` à `size` px dans `out` (PNG transparent). */
function render(svg, size, out) {
  const html = join(OUT, `_render-${size}.html`);
  const src = pathToFileURL(join(HERE, svg)).href;
  writeFileSync(
    html,
    `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}` +
      `img{display:block;width:${size}px;height:${size}px}</style></head>` +
      `<body><img src="${src}"></body></html>`,
  );
  execFileSync(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${out}`,
      pathToFileURL(html).href,
    ],
    { stdio: "ignore" },
  );
  if (!existsSync(out)) throw new Error(`Rendu échoué : ${out}`);
  console.log(`  ${svg} @${size}px → ${out}`);
}

/** Assemble un .ico à partir de PNG (format PNG-dans-ICO, Windows Vista+). */
function buildIco(entries, out) {
  const pngs = entries.map(({ size, file }) => ({ size, data: readFileSync(file) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type icône
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); // plans
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  writeFileSync(out, Buffer.concat([header, dir, ...pngs.map((p) => p.data)]));
  console.log(`  icon.ico (${pngs.map((p) => p.size).join(", ")}) → ${out}`);
}

console.log("[icônes] rendu…");
const master = join(OUT, "icon-1024.png");
render("asas-voice-icon.svg", 1024, master);

const icoEntries = [];
for (const size of [16, 20, 24, 32, 40, 48, 64]) {
  const file = join(OUT, `icon-${size}.png`);
  render("asas-voice-icon-small.svg", size, file);
  icoEntries.push({ size, file });
}
for (const size of [128, 256]) {
  const file = join(OUT, `icon-${size}.png`);
  render("asas-voice-icon.svg", size, file);
  icoEntries.push({ size, file });
}

render("tray-idle.svg", 32, join(DESKTOP, "src-tauri", "icons", "tray-idle.png"));
render("tray-live.svg", 32, join(DESKTOP, "src-tauri", "icons", "tray-live.png"));
render("asas-voice-mark.svg", 128, join(DESKTOP, "public", "logo.png"));

copyFileSync(master, join(DESKTOP, "design", "asas-voice-icon-master.png"));
console.log("[icônes] OK — lancer ensuite `pnpm tauri icon design/asas-voice-icon-master.png`,");
console.log("          puis remplacer src-tauri/icons/icon.ico par design/icon/out/icon.ico.");
buildIco(icoEntries, join(OUT, "icon.ico"));
