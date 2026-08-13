// POST /api/metadata/generate  { videoId, topicTitle? } -> AI title,
// description, and thumbnail-text options, validated (with retries) against
// lib/youtube-copy-rules.js. Never hard-fails on validation — a human
// reviews before select.js locks anything in.

const { getVideo, saveVideo } = require('../../../lib/video-store.js');
const { generateValidatedOptions } = require('../../../lib/metadata-agent.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, topicTitle } = body;

  if (!videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }
  if (!env.CLAUDE_API_KEY) {
    return Response.json(
      { error: 'CLAUDE_API_KEY is not configured — set it via `wrangler pages secret put CLAUDE_API_KEY`' },
      { status: 500 }
    );
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }
  if (video.status === 'uploading') {
    return Response.json(
      { error: `Video is still "${video.status}" — wait for the upload to complete first` },
      { status: 409 }
    );
  }

  const context_ = { topicTitle, filename: video.filename };
  const generated = await generateValidatedOptions(context_, env.CLAUDE_API_KEY, { maxAttempts: 3 });

  video.metadata = {
    ...(video.metadata || {}),
    titleOptions: generated.titleOptions,
    descriptionOptions: generated.descriptionOptions,
    thumbnailTextOptions: generated.thumbnailTextOptions,
    thumbnailCandidates: (video.metadata && video.metadata.thumbnailCandidates) || [],
    selectedTitle: (video.metadata && video.metadata.selectedTitle) || null,
    selectedDescription: (video.metadata && video.metadata.selectedDescription) || null,
    selectedThumbnailText: (video.metadata && video.metadata.selectedThumbnailText) || null,
    selectedThumbnailR2Key: (video.metadata && video.metadata.selectedThumbnailR2Key) || null,
    generationAttempts: ((video.metadata && video.metadata.generationAttempts) || 0) + 1,
    lastGeneratedAt: new Date().toISOString(),
  };
  await saveVideo(env, video);

  return Response.json({
    videoId: video.id,
    titleOptions: generated.titleOptions,
    descriptionOptions: generated.descriptionOptions,
    thumbnailTextOptions: generated.thumbnailTextOptions,
    validation: generated.validation,
  });
}
