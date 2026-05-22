import path from "path";
import fs from "fs";
import { createRequire } from "module";

/**
 * Logo SICS predefinito per il certificato PDF.
 *
 * Il file `public/logo/sics-logo.png` è **bianco** (pensato per la navbar con
 * sfondo turchese): su un foglio A4 bianco sarebbe invisibile. Lo ricoloriamo
 * lato server nel colore primario — stesso effetto del filtro CSS usato dalla
 * pagina di login (logo turchese su sfondo chiaro).
 *
 * Il logo è monocromatico: ogni pixel non trasparente diventa `color`,
 * preservando il canale alpha (anti-aliasing dei bordi incluso).
 *
 * Risultato in cache per colore: il ricoloro avviene una sola volta.
 */
const _cache = new Map<string, string | undefined>();
const require = createRequire(import.meta.url);

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function getDefaultLogoDataUri(color = "#00A1BE"): string | undefined {
  if (_cache.has(color)) return _cache.get(color);

  let result: string | undefined;
  try {
    const { PNG } = require("pngjs") as typeof import("pngjs");
    const file = path.join(process.cwd(), "public", "logo", "sics-logo.png");
    const png = PNG.sync.read(fs.readFileSync(file));
    const { r, g, b } = hexToRgb(color);
    for (let i = 0; i < png.data.length; i += 4) {
      // Mantiene l'alpha, sostituisce il colore (logo bianco monocromatico)
      if (png.data[i + 3] > 0) {
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
      }
    }
    const out = PNG.sync.write(png);
    result = `data:image/png;base64,${out.toString("base64")}`;
  } catch {
    result = undefined;
  }

  _cache.set(color, result);
  return result;
}
