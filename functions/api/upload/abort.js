// POST /api/upload/abort  { videoId } -> cancels an in-progress multipart
// upload. The video record is kept (status: "upload_failed") rather than
// deleted, so the dashboard can show "upload failed, retry" instead of the
// id silently vanishing from the list.

const { getVideo, updateVideoStatus } = require('../../../lib/video-store.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId } = body;

  if (!videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }

  if (video.status === 'uploading' && video.uploadState?.r2UploadId) {
    const multipartUpload = env.MEDIA.resumeMultipartUpload(video.r2Key, video.uploadState.r2UploadId);
    await multipartUpload.abort().catch(() => {
      // R2 returns an error if the upload was already aborted/completed —
      // the record still needs to move to upload_failed either way.
    });
  }

  await updateVideoStatus(env, videoId, 'upload_failed', { uploadState: null });

  return Response.json({ videoId, aborted: true });
}
