// GET /api/upload/<id>/status -> which parts have already landed for an
// in-progress upload, so a client resuming after a dropped connection or a
// browser refresh knows which chunks it can skip re-sending.

const { getVideo } = require('../../../../lib/video-store.js');

export async function onRequestGet(context) {
  const { env, params } = context;
  const videoId = params.id;

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }

  return Response.json({
    videoId: video.id,
    status: video.status,
    uploadState: video.uploadState
      ? {
          partsUploaded: video.uploadState.partsUploaded.map(p => ({ partNumber: p.partNumber })),
          bytesUploaded: video.uploadState.bytesUploaded,
        }
      : null,
  });
}
