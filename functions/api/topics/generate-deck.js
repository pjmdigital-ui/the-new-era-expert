// POST /api/topics/generate-deck  { id, regenerate?: boolean } -> generates
// (or returns the cached) on-camera slide deck for a topic, so clicking
// "Film this next" doesn't re-spend a Claude call every time it's reopened.
// Returns the full updated topic object (same shape as GET /api/topics/<id>)
// so the frontend can render directly from either response.

const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const { generateSlideDeck } = require('../../../lib/slide-deck.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { id, regenerate } = body;

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }
  if (!env.CLAUDE_API_KEY) {
    return Response.json(
      { error: 'CLAUDE_API_KEY is not configured — set it via `wrangler pages secret put CLAUDE_API_KEY`' },
      { status: 500 }
    );
  }

  const topics = await getTopics(env, seedData);
  const topic = topics.find(t => t.id === id);
  if (!topic) {
    return Response.json({ error: `No topic with id "${id}"` }, { status: 404 });
  }

  if (topic.slideDeck && !regenerate) {
    return Response.json(topic);
  }

  const slides = await generateSlideDeck(topic, env.CLAUDE_API_KEY);
  const slideDeck = { slides, generatedAt: new Date().toISOString() };

  const updated = topics.map(t => (t.id === id ? { ...t, slideDeck } : t));
  await saveTopics(env, updated);

  return Response.json(updated.find(t => t.id === id));
}
