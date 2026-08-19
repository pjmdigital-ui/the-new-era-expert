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
 *
 * Presenter-photo panel (buildFaceLayerElements): the source photos are
 * plain white-background cutouts, not alpha-transparent PNGs, so
 * compositing one directly onto a busy AI-generated background would show
 * an obviously unintentional white box. A white rounded-rect backing panel
 * behind the photo (with a purple accent border, matching the dashboard's
 * brand color) turns that same white background into a deliberate "photo
 * card" instead of a compositing bug. Sized to ~40% width / ~92% height of
 * the frame so the presenter's face has real visual presence rather than
 * sitting small in a corner -- high-CTR thumbnails generally want the face
 * to dominate.
 */

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

// Leaves margin on both sides so text never touches the frame edge, even
// with the widest plausible font substitution.
const SAFE_TEXT_WIDTH = CANVAS_WIDTH * 0.82;

const FACE_PANEL_WIDTH = CANVAS_WIDTH * 0.40;
const FACE_PANEL_HEIGHT = CANVAS_HEIGHT * 0.92;
const FACE_PANEL_MARGIN = CANVAS_WIDTH * 0.03;
const FACE_PANEL_BORDER_COLOR = '#a855f7';
const FACE_PANEL_BORDER_WIDTH = 6;

/**
 * Builds just the <text> element for the thumbnail's headline — the
 * fragment functions/api/metadata/thumbnail.js inlines into one composite
 * SVG alongside the AI-generated background <image> (and, when a presenter
 * photo is selected, the face panel from buildFaceLayerElements).
 *
 * @param {Object} opts
 * @param {string} opts.text — thumbnail text, already validated via
 *   youtube-copy-rules.js (2-4 words, ALL CAPS) before it reaches here
 * @param {string} [opts.fillColor='#FFFFFF']
 * @param {string} [opts.strokeColor='#000000'] — outline for legibility
 *   over a busy background image
 * @param {number} [opts.fontSize=110]
 * @param {number} [opts.y=CANVAS_HEIGHT * 0.82] — baseline position
 * @param {number} [opts.centerX=CANVAS_WIDTH / 2] — horizontal center of
 *   the text block. Overridden to sit left-of-center when a presenter
 *   photo panel occupies the right side of the frame.
 * @param {number} [opts.maxWidth=SAFE_TEXT_WIDTH] — hard textLength
 *   constraint paired with centerX, so the safe zone shrinks to match
 *   whatever horizontal space is actually available.
 * @returns {string} a single <text>...</text> element
 */
function buildThumbnailTextElement({
  text,
  fillColor = '#FFFFFF',
  strokeColor = '#000000',
  fontSize = 110,
  y = CANVAS_HEIGHT * 0.82,
  centerX = CANVAS_WIDTH / 2,
  maxWidth = SAFE_TEXT_WIDTH,
}) {
  if (!text || !text.trim()) {
    throw new Error('buildThumbnailTextElement requires non-empty text');
  }

  const escaped = escapeXml(text.trim());

  return `<text
    x="${centerX}"
    y="${y}"
    text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    fill="${fillColor}"
    stroke="${strokeColor}"
    stroke-width="${Math.round(fontSize * 0.045)}"
    paint-order="stroke fill"
    textLength="${maxWidth}"
    lengthAdjust="spacingAndGlyphs"
  >${escaped}</text>`;
}

/**
 * Builds the SVG markup for the thumbnail's text overlay layer. This SVG is
 * meant to be composited over the AI-generated background image (and
 * optional selfie/photo layer) — it is the text layer ONLY, not the full
 * thumbnail.
 *
 * @param {Object} opts — see buildThumbnailTextElement
 * @returns {string} SVG markup
 */
function buildThumbnailTextSVG(opts) {
  const textElement = buildThumbnailTextElement(opts);

  return `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  ${textElement}
</svg>`;
}

/**
 * Builds the presenter-photo panel: a white rounded-rect backing panel
 * with a purple accent border, plus the photo itself, clipped to the same
 * rounded rect and cropped to fill it (preserveAspectRatio="...slice").
 * Positioned as a right-side panel by default — pair with
 * buildThumbnailTextElement's centerX/maxWidth so the headline text moves
 * into the remaining left-hand space instead of colliding with it.
 *
 * @param {Object} opts
 * @param {string} opts.contentType — e.g. "image/jpeg"
 * @param {string} opts.base64 — the photo's raw bytes, base64-encoded
 * @param {number} [opts.width=FACE_PANEL_WIDTH]
 * @param {number} [opts.height=FACE_PANEL_HEIGHT]
 * @param {number} [opts.x] — defaults to a right-aligned panel
 * @param {number} [opts.y] — defaults to vertically centered
 * @returns {string} SVG markup — a <rect>, a <clipPath>, and an <image>
 */
function buildFaceLayerElements({
  contentType,
  base64,
  width = FACE_PANEL_WIDTH,
  height = FACE_PANEL_HEIGHT,
  x = CANVAS_WIDTH - width - FACE_PANEL_MARGIN,
  y = (CANVAS_HEIGHT - height) / 2,
}) {
  if (!base64) {
    throw new Error('buildFaceLayerElements requires base64 image data');
  }
  if (!contentType) {
    throw new Error('buildFaceLayerElements requires a contentType');
  }

  const cornerRadius = width * 0.04;
  const clipId = `face-clip-${Math.round(x)}-${Math.round(y)}`;

  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${cornerRadius}" fill="#ffffff" stroke="${FACE_PANEL_BORDER_COLOR}" stroke-width="${FACE_PANEL_BORDER_WIDTH}" />
  <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${cornerRadius}" /></clipPath>
  <image href="data:${contentType};base64,${base64}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${clipId})" />`;
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
  FACE_PANEL_WIDTH,
  FACE_PANEL_HEIGHT,
  FACE_PANEL_MARGIN,
  buildThumbnailTextElement,
  buildThumbnailTextSVG,
  buildFaceLayerElements,
  textLikelyOverflows,
};
