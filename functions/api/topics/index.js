// GET /api/topics -> ranked topic list

const { rankTopics } = require('../../../lib/topic-ranker.js');
const { getTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestGet(context) {
  const { env } = context;
  const topics = await getTopics(env, seedData);
  const ranked = rankTopics(topics);
  return Response.json({
    topics: ranked,
    nextUp: ranked[0] || null,
    count: ranked.length,
  });
}
