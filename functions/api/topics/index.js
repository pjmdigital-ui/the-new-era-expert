// GET /api/topics -> ranked topic list, plus any discovered candidates
// awaiting human review (see functions/api/topics/discover.js).

const { rankTopics } = require('../../../lib/topic-ranker.js');
const { getTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestGet(context) {
  const { env } = context;
  const topics = await getTopics(env, seedData);
  // The 42 seed topics predate the status field entirely — treat a missing
  // status as 'active' so they still show up in the ranked list.
  const ranked = rankTopics(topics.filter(t => !t.status || t.status === 'active'));
  const candidates = topics.filter(t => t.status === 'candidate');
  return Response.json({
    topics: ranked,
    nextUp: ranked[0] || null,
    count: ranked.length,
    candidates,
  });
}
