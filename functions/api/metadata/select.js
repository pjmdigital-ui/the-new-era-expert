// POST /api/metadata/select  { videoId, selectedTitle, selectedDescription,
// selectedThumbnailText, selectedThumbnailR2Key } -> locks in the chosen
// metadata and advances the video to "metadata_generated". This is the
// final gate before publish-youtube.js, so validation here is hard — unlike
// generate.js's never-fail retry loop.

const { getVideo, updateVideoStatus } = require('../../../lib/video-store.js');
const {
  validateTitle,
  validateThumbnailText,
  validateTitleThumbnailPair,
} = require('../../../lib/youtube-copy-rules.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, selectedTitle, selectedDescription, selectedThumbnailText, selectedThumbnailR2Key } = body;

  if (!videoId || !selectedTitle || !selectedDescription || !selectedThumbnailText || !selectedThumbnailR2Key) {
    return Response.json(
      { error: 'videoId, selectedTitle, selectedDescription, selectedThumbnailText, and selectedThumbnailR2Key are all required' },
      { status: 400 }
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

  const issues = [
    ...validateTitle(selectedTitle).issues,
    ...validateThumbnailText(selectedThumbnailText).issues,
    ...validateTitleThumbnailPair(selectedTitle, selectedThumbnailText).issues,
  ];
  if (issues.length > 0) {
    return Response.json({ error: 'Selected metadata failed validation', issues }, { status: 422 });
  }

  const updated = await updateVideoStatus(env, videoId, 'metadata_generated', {
    metadata: {
      ...video.metadata,
      selectedTitle,
      selectedDescription,
      selectedThumbnailText,
      selectedThumbnailR2Key,
    },
  });

  return Response.json({ videoId: updated.id, status: updated.status, metadata: updated.metadata });
}
