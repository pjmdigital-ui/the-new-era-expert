// POST /api/metadata/thumbnail-upload?videoId=<id>&filename=<name>
// Body: raw image bytes.
// -> stores a manually-provided image (e.g. designed in ChatGPT) directly
// in R2 as a thumbnail candidate, bypassing AI generation entirely. Lands
// in the same video.metadata.thumbnailCandidates array the AI-generated
// path writes to, so it shows up in the existing candidate grid and is
// selectable/lockable with no changes needed to that UI or the
// select.js/lock-in flow.

const { getVideo, saveVideo } = require('../../../lib/video-store.js');

const ALLOWED_EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('videoId');
  const filename = url.searchParams.get('filename') || 'thumbnail.png';

  if (!videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }

  const extension = (filename.split('.').pop() || '').toLowerCase();
  const contentType = ALLOWED_EXTENSIONS[extension];
  if (!contentType) {
    return Response.json(
      { error: `Unsupported image type ".${extension}" — use png, jpg, or webp` },
      { status: 400 }
    );
  }

  const bytes = await request.arrayBuffer();
  if (!bytes || bytes.byteLength === 0) {
    return Response.json({ error: 'No image data received' }, { status: 400 });
  }

  const maxBytes = Number(env.THUMBNAIL_MAX_BYTES) || 2 * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    return Response.json(
      { error: `Image is ${bytes.byteLength} bytes, exceeding YouTube's ${maxBytes}-byte thumbnail limit` },
      { status: 413 }
    );
  }

  const createdAt = new Date().toISOString();
  const r2Key = `thumbnails/${videoId}/${Date.now()}.${extension}`;
  await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType } });

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
    { r2Key, thumbnailText: 'Uploaded thumbnail', faceR2Key: null, createdAt, uploaded: true },
  ];
  await saveVideo(env, video);

  return Response.json({
    videoId: video.id,
    thumbnailR2Key: r2Key,
    candidateCount: video.metadata.thumbnailCandidates.length,
  });
}
