// GET /api/videos -> list of video summaries (id, filename, status, createdAt,
// updatedAt) for the dashboard's video library view. Thin wrapper over
// listVideos() — no new business logic.

const { listVideos } = require('../../../lib/video-store.js');

export async function onRequestGet(context) {
  const { env } = context;
  const videos = await listVideos(env);
  return Response.json({ videos });
}
