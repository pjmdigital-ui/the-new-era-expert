// GET /api/videos/<id> -> the full video record (metadata, youtube, clips
// included) for the dashboard's detail view. Thin wrapper over getVideo() —
// no new business logic.

const { getVideo } = require('../../../lib/video-store.js');

export async function onRequestGet(context) {
  const { env, params } = context;
  const video = await getVideo(env, params.id);
  if (!video) {
    return Response.json({ error: `No video with id "${params.id}"` }, { status: 404 });
  }
  return Response.json(video);
}
