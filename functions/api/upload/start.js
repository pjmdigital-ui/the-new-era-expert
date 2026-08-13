// POST /api/upload/start  { filename, sizeBytes, mimeType } -> opens an R2
// multipart upload and creates the video's pipeline record. The video id is
// generated here (not inside video-store.js) so it can be embedded in the
// R2 key before the multipart upload is opened.

const { createVideo } = require('../../../lib/video-store.js');

// R2 requires every part but the last to be >=5MiB. 10MiB stays comfortably
// above that floor while keeping part counts reasonable for an 8-15 minute
// talking-head video.
const RECOMMENDED_PART_SIZE_BYTES = 10 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { filename, sizeBytes, mimeType } = body;

  if (!filename || !sizeBytes || !mimeType) {
    return Response.json(
      { error: 'filename, sizeBytes, and mimeType are all required' },
      { status: 400 }
    );
  }

  const id = crypto.randomUUID();
  const r2Key = `videos/${id}/${filename}`;
  const multipartUpload = await env.MEDIA.createMultipartUpload(r2Key);

  const video = await createVideo(env, {
    id,
    filename,
    sizeBytes,
    mimeType,
    r2Key,
    r2UploadId: multipartUpload.uploadId,
  });

  return Response.json({
    videoId: video.id,
    r2Key: video.r2Key,
    r2UploadId: multipartUpload.uploadId,
    recommendedPartSizeBytes: RECOMMENDED_PART_SIZE_BYTES,
  });
}
