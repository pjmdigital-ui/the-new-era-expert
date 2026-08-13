// POST /api/upload/complete  { videoId } -> finalizes the R2 multipart
// upload using the server's own tracked part list (never a client-supplied
// one — the KV record is the authoritative source of which parts actually
// landed) and advances the video to "uploaded".

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
  if (video.status !== 'uploading') {
    return Response.json(
      { error: `Video is "${video.status}", not "uploading" — nothing to complete` },
      { status: 409 }
    );
  }

  const partsUploaded = [...video.uploadState.partsUploaded].sort((a, b) => a.partNumber - b.partNumber);
  if (partsUploaded.length === 0) {
    return Response.json({ error: 'No parts have been uploaded for this video yet' }, { status: 400 });
  }

  const multipartUpload = env.MEDIA.resumeMultipartUpload(video.r2Key, video.uploadState.r2UploadId);
  await multipartUpload.complete(partsUploaded);

  const updated = await updateVideoStatus(env, videoId, 'uploaded', { uploadState: null });

  return Response.json({
    videoId: updated.id,
    status: updated.status,
    r2Key: updated.r2Key,
    sizeBytes: updated.sizeBytes,
  });
}
