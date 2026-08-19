// POST /api/videos/link-topic  { videoId, topicId } -> associates a video
// with one of the topics list's entries, storing topicId + a denormalized
// topicTitle on the video record. Passing topicId: null unlinks. Metadata
// generation (functions/api/metadata/generate.js) already reads
// topicTitle from its request body -- this is what actually populates it,
// closing the gap where a video otherwise only had its filename as
// context for what it's about.

const { getVideo, saveVideo } = require('../../../lib/video-store.js');
const { getTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { videoId, topicId } = body;

  if (!videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }

  const video = await getVideo(env, videoId);
  if (!video) {
    return Response.json({ error: `No video with id "${videoId}"` }, { status: 404 });
  }

  if (!topicId) {
    video.topicId = null;
    video.topicTitle = null;
    await saveVideo(env, video);
    return Response.json(video);
  }

  const topics = await getTopics(env, seedData);
  const topic = topics.find(t => t.id === topicId);
  if (!topic) {
    return Response.json({ error: `No topic with id "${topicId}"` }, { status: 404 });
  }

  video.topicId = topic.id;
  video.topicTitle = topic.title;
  await saveVideo(env, video);

  return Response.json(video);
}
