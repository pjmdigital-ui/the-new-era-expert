// POST /api/repurpose/approve  { videoId, clipId, approved } -> the human
// approval-queue gate the README requires: nothing goes live without a
// human glance. publish.js hard-enforces this — it 409s on any clip whose
// status isn't "approved", so this route can't be bypassed by calling
// publish.js directly.

const { updateClip } = require('../../../lib/video-store.js');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, clipId, approved } = body;

  if (!videoId || !clipId || typeof approved !== 'boolean') {
    return Response.json({ error: 'videoId, clipId, and a boolean approved are required' }, { status: 400 });
  }

  const updated = await updateClip(env, videoId, clipId, { status: approved ? 'approved' : 'rejected' });
  if (!updated) {
    return Response.json({ error: `No clip "${clipId}" on video "${videoId}"` }, { status: 404 });
  }

  const clip = updated.clips.find(c => c.id === clipId);
  return Response.json({ videoId: updated.id, clipId, status: clip.status });
}
