// GET /api/topics/<id> -> the full topic record (includes slideDeck once
// generated). Thin wrapper over getTopics() — no new business logic.

const { getTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestGet(context) {
  const { env, params } = context;
  const topics = await getTopics(env, seedData);
  const topic = topics.find(t => t.id === params.id);
  if (!topic) {
    return Response.json({ error: `No topic with id "${params.id}"` }, { status: 404 });
  }
  return Response.json(topic);
}
