// POST /api/metadata/thumbnail  { videoId, thumbnailText, backgroundPrompt? }
// -> generates an AI background (no-text prompt), composites the validated
// thumbnail text on top as a single SVG, rasterizes it via resvg-wasm, and
// stores the PNG in R2. Candidates are appended, never overwritten, so
// prior attempts stay comparable.

const { getVideo, saveVideo } = require('../../../lib/video-store.js');
const { validateThumbnailText } = require('../../../lib/youtube-copy-rules.js');
const { generateBackgroundImage } = require('../../../lib/thumbnail-image.js');
const { renderSVGToPNG } = require('../../../lib/thumbnail-render.js');
const { CANVAS_WIDTH, CANVAS_HEIGHT, buildThumbnailTextElement } = require('../../../lib/thumbnail.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, thumbnailText, backgroundPrompt } = body;

  if (!videoId || !thumbnailText) {
    return Response.json({ error: 'videoId and thumbnailText are required' }, { status: 400 });
  }

  const validation = validateThumbnailText(thumbnailText);
  if (!validation.valid) {
    return Response.json({ error: 'Invalid thumbnail text', issues: validation.issues }, { status: 422 });
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

  const background = await generateBackgroundImage(backgroundPrompt, env.IMAGE_GEN_API_KEY);
  const backgroundB64 = bytesToBase64(background.bytes);
  const textElement = buildThumbnailTextElement({ text: thumbnailText });

  const compositeSVG = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <image href="data:${background.contentType};base64,${backgroundB64}" x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" preserveAspectRatio="xMidYMid slice" />
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
    { r2Key, thumbnailText, createdAt },
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
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
