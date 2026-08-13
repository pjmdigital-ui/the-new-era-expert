// POST /api/upload/part?videoId=<id>&partNumber=<n>  (raw binary body) ->
// uploads one chunk of an in-progress multipart upload. Workers isolates
// don't persist state across requests, so the multipart upload handle is
// re-opened via resumeMultipartUpload() every call, and progress is tracked
// in the video's KV record (the only durable state between requests).

const { getVideo, saveVideo } = require('../../../lib/video-store.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('videoId');
  const partNumber = Number(url.searchParams.get('partNumber'));

  if (!videoId || !partNumber || partNumber < 1) {
    return Response.json(
      { error: 'videoId and a positive partNumber query param are required' },
      { status: 400 }
    );
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }
  if (video.status !== 'uploading') {
    return Response.json(
      { error: `Video is "${video.status}", not "uploading" — cannot accept more parts` },
      { status: 409 }
    );
  }

  const bytes = await request.arrayBuffer();
  const multipartUpload = env.MEDIA.resumeMultipartUpload(video.r2Key, video.uploadState.r2UploadId);
  const uploadedPart = await multipartUpload.uploadPart(partNumber, bytes);

  // Dedupe by partNumber so a client retrying a part after a dropped
  // response (upload succeeded, response didn't arrive) doesn't double-count
  // it in partsUploaded.
  const partsUploaded = video.uploadState.partsUploaded.filter(p => p.partNumber !== partNumber);
  partsUploaded.push({ partNumber, etag: uploadedPart.etag });

  video.uploadState.partsUploaded = partsUploaded;
  video.uploadState.bytesUploaded += bytes.byteLength;
  await saveVideo(env, video);

  return Response.json({
    partNumber,
    etag: uploadedPart.etag,
    partsUploadedCount: partsUploaded.length,
  });
}
