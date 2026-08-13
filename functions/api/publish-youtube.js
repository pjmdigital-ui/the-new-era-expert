// POST /api/publish-youtube  { videoId, privacyStatus? } -> publishes the
// video to YouTube via the resumable upload protocol and sets the selected
// thumbnail. One route, two chained YouTube calls — this does not violate
// the one-route-per-file rule, which is about avoiding sub-path
// collisions, not limiting external calls per file.

const { getVideo, updateVideoStatus } = require('../../lib/video-store.js');
const { getAccessToken } = require('../../lib/youtube-oauth.js');
const { startResumableUpload, uploadVideoBytes, setThumbnail } = require('../../lib/youtube-publish.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, privacyStatus = 'private' } = body;

  if (!videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }
  if (video.status !== 'metadata_generated') {
    return Response.json(
      { error: `Video is "${video.status}", not "metadata_generated" — select metadata first via /api/metadata/select` },
      { status: 400 }
    );
  }
  if (video.youtube && video.youtube.videoId) {
    return Response.json({ error: 'Video has already been published to YouTube — no re-publish path yet' }, { status: 400 });
  }

  const missingSecrets = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'].filter(
    name => !env[name]
  );
  if (missingSecrets.length > 0) {
    return Response.json(
      { error: `Missing secrets: ${missingSecrets.join(', ')} — set each via \`wrangler pages secret put <NAME>\`` },
      { status: 500 }
    );
  }

  const accessToken = await getAccessToken(env);

  const videoObject = await env.MEDIA.get(video.r2Key);
  if (!videoObject) {
    return Response.json({ error: `Video file not found in R2 at "${video.r2Key}"` }, { status: 404 });
  }

  const uploadUrl = await startResumableUpload(
    {
      title: video.metadata.selectedTitle,
      description: video.metadata.selectedDescription,
      categoryId: env.YOUTUBE_UPLOAD_CATEGORY_ID || '27',
      privacyStatus,
    },
    video.sizeBytes,
    video.mimeType,
    accessToken
  );

  const { videoId: youtubeVideoId } = await uploadVideoBytes(
    uploadUrl,
    videoObject.body,
    video.sizeBytes,
    video.mimeType
  );

  const thumbnailObject = await env.MEDIA.get(video.metadata.selectedThumbnailR2Key);
  if (thumbnailObject) {
    const thumbnailBytes = new Uint8Array(await thumbnailObject.arrayBuffer());
    await setThumbnail(accessToken, youtubeVideoId, thumbnailBytes);
  }

  const publishedAt = new Date().toISOString();
  const updated = await updateVideoStatus(env, videoId, 'published', {
    youtube: {
      videoId: youtubeVideoId,
      url: `https://youtu.be/${youtubeVideoId}`,
      publishedAt,
      privacyStatus,
    },
  });

  return Response.json({ videoId: updated.id, youtube: updated.youtube, status: updated.status });
}
