// POST /api/metadata/select  { videoId, selectedTitle, selectedDescription }
// -> locks in the chosen title/description and advances the video to
// "metadata_generated". This is the final gate before manual publish, so
// validation here is hard — unlike generate.js's never-fail retry loop.
//
// Thumbnail selection is intentionally NOT part of this gate — thumbnails
// are handled entirely manually in YouTube Studio now, not in-app.
// selectedThumbnailText/selectedThumbnailR2Key are accepted as optional
// pass-through fields (kept for any already-locked videos that still carry
// them from before this change) but are never required.

const { getVideo, updateVideoStatus } = require('../../../lib/video-store.js');
const { validateTitle } = require('../../../lib/youtube-copy-rules.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, selectedTitle, selectedDescription, selectedThumbnailText, selectedThumbnailR2Key } = body;

  if (!videoId || !selectedTitle || !selectedDescription) {
    return Response.json(
      { error: 'videoId, selectedTitle, and selectedDescription are all required' },
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

  const issues = validateTitle(selectedTitle).issues;
  if (issues.length > 0) {
    return Response.json({ error: 'Selected metadata failed validation', issues }, { status: 422 });
  }

  const updated = await updateVideoStatus(env, videoId, 'metadata_generated', {
    metadata: {
      ...video.metadata,
      selectedTitle,
      selectedDescription,
      selectedThumbnailText: selectedThumbnailText || null,
      selectedThumbnailR2Key: selectedThumbnailR2Key || null,
    },
  });

  return Response.json({ videoId: updated.id, status: updated.status, metadata: updated.metadata });
}
