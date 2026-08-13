// POST /api/topics/cover  { id: string } -> marks a topic covered

const { rankTopics } = require('../../../lib/topic-ranker.js');
const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  if (!body.id) {
    return Response.json({ error: 'body.id is required' }, { status: 400 });
  }

  const topics = await getTopics(env, seedData);
  if (!topics.some(t => t.id === body.id)) {
    return Response.json({ error: `No topic with id "${body.id}"` }, { status: 404 });
  }

  const updated = topics.map(t =>
    t.id === body.id
      ? { ...t, timesCovered: t.timesCovered + 1, lastCoveredAt: new Date().toISOString() }
      : t
  );
  await saveTopics(env, updated);

  const ranked = rankTopics(updated);
  return Response.json({ topics: ranked, nextUp: ranked[0] || null });
}
