/**
 * Wraps @resvg/resvg-wasm to rasterize the composite thumbnail SVG (AI
 * background + text overlay, see functions/api/metadata/thumbnail.js) to
 * PNG inside the Worker — this repo's first runtime npm dependency (see
 * package.json / wrangler.toml).
 *
 * NOT covered by `node --test`: resvg-wasm's WASM import has no meaningful
 * behavior outside a bundled Workers runtime, and isn't installed as a
 * plain Node dependency here. Verify with `wrangler pages dev` before
 * trusting this in production — the wasm import + bundle size under Pages
 * Functions' bundler is unverified against this repo's actual toolchain.
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
// wrangler's built-in .wasm module support resolves this to a
// WebAssembly.Module at build time.
import wasmModule from '@resvg/resvg-wasm/index_bg.wasm';

let wasmReady = null;

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
 * @param {string} svgString
 * @returns {Promise<Uint8Array>} PNG bytes
 */
async function renderSVGToPNG(svgString) {
  await initResvg();
  const resvg = new Resvg(svgString);
  const rendered = resvg.render();
  return rendered.asPng();
}

module.exports = { initResvg, renderSVGToPNG };
