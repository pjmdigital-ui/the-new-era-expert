// POST /api/metadata/thumbnail  { videoId, thumbnailText, backgroundPrompt?, faceR2Key? }
// -> generates an AI background (no-text prompt), optionally composites a
// presenter photo from the MEDIA bucket's faces/ prefix as a framed panel,
// composites the validated thumbnail text on top (shifted left of the photo
// panel when one is present) as a single SVG, rasterizes it via
// resvg-wasm, and stores the PNG in R2. Candidates are appended, never
// overwritten, so prior attempts stay comparable.

const { getVideo, saveVideo } = require('../../../lib/video-store.js');
const { validateThumbnailText } = require('../../../lib/youtube-copy-rules.js');
const { generateBackgroundImage } = require('../../../lib/thumbnail-image.js');
const { renderSVGToPNG } = require('../../../lib/thumbnail-render.js');
const {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FACE_PANEL_WIDTH,
  FACE_PANEL_MARGIN,
  buildThumbnailTextElement,
  buildFaceLayerElements,
} = require('../../../lib/thumbnail.js');

const FACE_PREFIX = 'faces/';

export async function onRequestPost(context) {
  // Wrapped so any unhandled exception (WASM init failure, image-gen call
  // throwing, etc.) comes back as a readable JSON error instead of
  // Cloudflare's generic edge crash page ("error code: 1101"), which gives
  // no information about what actually broke.
  try {
    return await handleThumbnailRequest(context);
  } catch (err) {
    return Response.json(
      {
        error: `Unhandled error generating thumbnail: ${err && err.message}`,
        stack: err && err.stack ? String(err.stack).split('\n').slice(0, 5).join('\n') : undefined,
      },
      { status: 500 }
    );
  }
}

async function handleThumbnailRequest(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, thumbnailText, backgroundPrompt, faceR2Key } = body;

  if (!videoId || !thumbnailText) {
    return Response.json({ error: 'videoId and thumbnailText are required' }, { status: 400 });
  }

  const validation = validateThumbnailText(thumbnailText);
  if (!validation.valid) {
    return Response.json({ error: 'Invalid thumbnail text', issues: validation.issues }, { status: 422 });
  }

  if (faceR2Key && !faceR2Key.startsWith(FACE_PREFIX)) {
    return Response.json({ error: `faceR2Key must start with "${FACE_PREFIX}"` }, { status: 400 });
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }
  if (!env.IMAGE_GEN_API_KEY) {
    return Response.json(
      { error: 'IMAGE_GEN_API_KEY is not configured — set it via `wrangler pages secret put IMAGE_GEN_API_KEY`' },
      { status: 500 }
    );
  }

  let faceLayer = '';
  let textCenterX;
  let textMaxWidth;
  if (faceR2Key) {
    const faceObject = await env.MEDIA.get(faceR2Key);
    if (!faceObject) {
      return Response.json({ error: `No presenter photo at "${faceR2Key}"` }, { status: 404 });
    }
    const faceBytes = new Uint8Array(await faceObject.arrayBuffer());
    const faceContentType = faceObject.httpMetadata?.contentType || 'image/jpeg';
    faceLayer = buildFaceLayerElements({ contentType: faceContentType, base64: bytesToBase64(faceBytes) });
    // Text moves into the remaining left-hand area so it doesn't collide
    // with the photo panel occupying the right side of the frame.
    const leftAreaWidth = CANVAS_WIDTH - FACE_PANEL_WIDTH - FACE_PANEL_MARGIN * 2;
    textCenterX = leftAreaWidth / 2;
    textMaxWidth = leftAreaWidth * 0.85;
  }

  const background = await generateBackgroundImage(backgroundPrompt, env.IMAGE_GEN_API_KEY);
  const backgroundB64 = bytesToBase64(background.bytes);
  const textElement = buildThumbnailTextElement({
    text: thumbnailText,
    ...(textCenterX !== undefined ? { centerX: textCenterX, maxWidth: textMaxWidth } : {}),
  });

  const compositeSVG = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <image href="data:${background.contentType};base64,${backgroundB64}" x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" preserveAspectRatio="xMidYMid slice" />
  ${faceLayer}
  ${textElement}
</svg>`;

  const pngBytes = await renderSVGToPNG(compositeSVG);

  const maxBytes = Number(env.THUMBNAIL_MAX_BYTES) || 2 * 1024 * 1024;
  if (pngBytes.byteLength > maxBytes) {
    return Response.json(
      { error: `Rendered thumbnail is ${pngBytes.byteLength} bytes, exceeding the ${maxBytes}-byte limit` },
      { status: 500 }
    );
  }

  const createdAt = new Date().toISOString();
  const r2Key = `thumbnails/${videoId}/${Date.now()}.png`;
  await env.MEDIA.put(r2Key, pngBytes, { httpMetadata: { contentType: 'image/png' } });

  video.metadata = video.metadata || {
    titleOptions: [],
    descriptionOptions: [],
    thumbnailTextOptions: [],
    thumbnailCandidates: [],
    selectedTitle: null,
    selectedDescription: null,
    selectedThumbnailText: null,
    selectedThumbnailR2Key: null,
    generationAttempts: 0,
    lastGeneratedAt: null,
  };
  video.metadata.thumbnailCandidates = [
    ...(video.metadata.thumbnailCandidates || []),
    { r2Key, thumbnailText, faceR2Key: faceR2Key || null, createdAt },
  ];
  await saveVideo(env, video);

  return Response.json({
    videoId: video.id,
    thumbnailR2Key: r2Key,
    thumbnailText,
    candidateCount: video.metadata.thumbnailCandidates.length,
  });
}

function bytesToBase64(bytes) {
  // Chunked String.fromCharCode.apply rather than a per-character
  // concatenation loop -- meaningfully faster for a multi-hundred-KB
  // image, which matters since this route may be close to Cloudflare's
  // per-request CPU time limit. 0x8000 stays comfortably under engines'
  // max-arguments ceiling for Function.prototype.apply.
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}
