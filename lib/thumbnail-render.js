/**
 * Wraps @resvg/resvg-wasm to rasterize the composite thumbnail SVG (AI
 * background + text overlay, see functions/api/metadata/thumbnail.js) to
 * PNG inside the Worker.
 *
 * Font: Cloudflare Workers have no filesystem and no system font store, so
 * resvg has nothing to render <text> elements with unless a font is
 * explicitly supplied as an in-memory buffer — confirmed live: without
 * this, the background image composites fine (it's just a raster <image>)
 * but every <text> element silently renders as nothing, no error thrown.
 * Rather than committing a font binary into the repo (base64-embedding a
 * ~90KB font as a JS string turned out to be impractically large), the
 * font is fetched once per isolate from a stable public URL (Google's own
 * open-source fonts repo on GitHub) and cached in memory, the same
 * lazy-init-once pattern already used for the WASM module below.
 *
 * Font options (fontBuffers, loadSystemFonts, defaultFontFamily,
 * sansSerifFamily, etc.) live directly on ResvgRenderOptions -- NOT nested
 * under a "font" key. Confirmed against the package's actual .d.ts after a
 * first attempt with a nested { font: {...} } shape was silently ignored
 * (resvg kept loadSystemFonts at its real default of true, found nothing
 * to load in the sandbox, and rendered no text).
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
// wrangler's built-in .wasm module support resolves this to a
// WebAssembly.Module at build time.
import wasmModule from '@resvg/resvg-wasm/index_bg.wasm';

// Archivo Black (SIL Open Font License 1.1) — a single-weight bold display
// face, well suited to thumbnail headlines. Served from Google's own
// fonts repo, which is stable/CDN-backed (GitHub raw + Fastly).
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf';
const FONT_FAMILY = 'Archivo Black';

let wasmReady = null;
let fontBytesPromise = null;

/**
 * Initializes the resvg WASM module once per isolate. Safe to call on
 * every request — later calls reuse the same in-flight/completed promise
 * instead of re-initializing.
 */
function initResvg() {
  if (!wasmReady) {
    wasmReady = initWasm(wasmModule);
  }
  return wasmReady;
}

/**
 * Fetches and caches the thumbnail headline font, once per isolate.
 *
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Uint8Array>}
 */
function getFontBytes(fetchFn = fetch) {
  if (!fontBytesPromise) {
    fontBytesPromise = fetchFn(FONT_URL).then(async res => {
      if (!res.ok) {
        throw new Error(`Failed to fetch thumbnail font: ${res.status} ${await res.text()}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    });
  }
  return fontBytesPromise;
}

/**
 * @param {string} svgString
 * @param {typeof fetch} [fetchFn] — injectable for testing
 * @returns {Promise<Uint8Array>} PNG bytes
 */
async function renderSVGToPNG(svgString, fetchFn = fetch) {
  await initResvg();
  const fontBytes = await getFontBytes(fetchFn);

  const resvg = new Resvg(svgString, {
    fontBuffers: [fontBytes],
    loadSystemFonts: false,
    defaultFontFamily: FONT_FAMILY,
    sansSerifFamily: FONT_FAMILY,
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

module.exports = { FONT_FAMILY, initResvg, getFontBytes, renderSVGToPNG };
