// POST /api/topics/refresh -> re-scores a batch of topics against real
// YouTube demand data and writes the updated scores back to KV.

const { rankTopics } = require('../../../lib/topic-ranker.js');
const { scoreTopic } = require('../../../lib/topic-agent.js');
const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

// YouTube's daily quota is limited and each topic scored costs 2 API
// calls (search + stats). Refresh scores whichever topics need it most
// (never-scored first, then staleness) rather than everything at once.
const MAX_TOPICS_PER_REFRESH = 8;

export async function onRequestPost(context) {
  const { env } = context;

  if (!env.YOUTUBE_DATA_API_KEY) {
    return Response.json(
      { error: 'YOUTUBE_DATA_API_KEY is not configured — set it via `wrangler pages secret put YOUTUBE_DATA_API_KEY`' },
      { status: 500 }
    );
  }

  const topics = await getTopics(env, seedData);

  const candidates = [...topics]
    .sort((a, b) => (a.demandScoredAt || '').localeCompare(b.demandScoredAt || ''))
    .slice(0, MAX_TOPICS_PER_REFRESH);

  const results = await Promise.allSettled(
    candidates.map(async topic => {
      const score = await scoreTopic(topic, env.YOUTUBE_DATA_API_KEY);
      return { id: topic.id, score };
    })
  );

  const scoreById = new Map();
  const errors = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      scoreById.set(result.value.id, result.value.score);
    } else {
      errors.push(result.reason?.message || String(result.reason));
    }
  }

  const updated = topics.map(t =>
    scoreById.has(t.id)
      ? { ...t, demandScore: scoreById.get(t.id), demandScoredAt: new Date().toISOString() }
      : t
  );
  await saveTopics(env, updated);

  const ranked = rankTopics(updated);
  return Response.json({
    topics: ranked,
    nextUp: ranked[0] || null,
    scoredCount: scoreById.size,
    errors: errors.length > 0 ? errors : undefined,
  });
}
