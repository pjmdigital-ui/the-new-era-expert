/**
 * Thumbnail text compositing — implements the brief's Section 5 lesson:
 *
 * Never ask an AI image model to render the on-image text itself (prompted
 * text generation is unreliable — garbled/misspelled text). Instead:
 *   1. Generate the background image via AI with a NO-TEXT prompt.
 *   2. Optionally composite a real photo/selfie on top.
 *   3. Draw the headline text yourself, in code, so you control exact
 *      positioning and sizing.
 *
 * And within step 3: don't trust font-availability assumptions. The
 * environment rendering the image may substitute a different (often wider)
 * font than the one requested at the same declared size, which can make
 * text overflow the frame if you just estimate a font size and hope. Use a
 * hard constraint — SVG's textLength + lengthAdjust="spacingAndGlyphs" —
 * so the rendered text is forced to fit inside a safe boundary regardless
 * of which font actually renders.
 */

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

// Leaves margin on both sides so text never touches the frame edge, even
// with the widest plausible font substitution.
const SAFE_TEXT_WIDTH = CANVAS_WIDTH * 0.82;

/**
 * Builds the SVG markup for the thumbnail's text overlay layer. This SVG is
 * meant to be composited over the AI-generated background image (and
 * optional selfie/photo layer) — it is the text layer ONLY, not the full
 * thumbnail.
 *
 * NOTE — rasterization to PNG/JPEG is not solved here. Cloudflare Workers
 * doesn't support native canvas/sharp bindings. Two realistic options to
 * evaluate before this ships: a WASM-based SVG renderer that runs in
 * Workers (e.g. resvg-wasm), or calling out to an external rendering
 * service. Pick one and wire it in `functions/api/generate-metadata.js`
 * rather than assuming either works without testing it in this specific
 * runtime.
 *
 * @param {Object} opts
 * @param {string} opts.text — thumbnail text, already validated via
 *   youtube-copy-rules.js (2-4 words, ALL CAPS) before it reaches here
 * @param {string} [opts.fillColor='#FFFFFF']
 * @param {string} [opts.strokeColor='#000000'] — outline for legibility
 *   over a busy background image
 * @param {number} [opts.fontSize=110]
 * @param {number} [opts.y=CANVAS_HEIGHT * 0.82] — baseline position
 * @returns {string} SVG markup
 */
function buildThumbnailTextSVG({
  text,
  fillColor = '#FFFFFF',
  strokeColor = '#000000',
  fontSize = 110,
  y = CANVAS_HEIGHT * 0.82,
}) {
  if (!text || !text.trim()) {
    throw new Error('buildThumbnailTextSVG requires non-empty text');
  }

  const escaped = escapeXml(text.trim());
  const x = CANVAS_WIDTH / 2;

  return `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text
    x="${x}"
    y="${y}"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    fill="${fillColor}"
    stroke="${strokeColor}"
    stroke-width="${Math.round(fontSize * 0.045)}"
    paint-order="stroke fill"
    textLength="${SAFE_TEXT_WIDTH}"
    lengthAdjust="spacingAndGlyphs"
  >${escaped}</text>
</svg>`;
}

/**
 * Only applies the hard textLength constraint when the text would actually
 * overflow — short text (e.g. "STOP THIS") shouldn't get artificially
 * stretched to fill the full safe width, which looks wrong. This does a
 * rough character-count estimate (not a real text-measurement pass, since
 * that requires a rendering context this module doesn't have) to decide
 * whether to apply textLength at all.
 *
 * @param {string} text
 * @param {number} fontSize
 * @returns {boolean}
 */
function textLikelyOverflows(text, fontSize) {
  // Rough average glyph width for a bold sans-serif at this size — generous
  // on purpose, since UNDER-estimating overflow risk is the actual bug this
  // whole module exists to prevent.
  const roughGlyphWidth = fontSize * 0.62;
  return text.length * roughGlyphWidth > SAFE_TEXT_WIDTH;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SAFE_TEXT_WIDTH,
  buildThumbnailTextSVG,
  textLikelyOverflows,
};
