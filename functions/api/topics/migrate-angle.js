// One-off migration, safe to run more than once (no-op once nothing is
// missing). KV already had topics persisted before the pain/pleasure
// `angle` field existed. lib/topics-store.js's getTopics() only seeds
// from data/seed-topics.json when KV is completely empty, so updating the
// seed file alone never reaches topics already stored -- this route
// patches `angle` onto every existing topic missing it (every
// pre-existing topic was pain-avoidance) and appends any seed topics not
// yet present by id (the new opportunity-* pleasure-seeking topics),
// without touching any other field on existing topics (demandScore,
// timesCovered, slideDeck, editedAt all stay exactly as they are).
// Delete this route once it's been run against production.

const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestPost(context) {
  const { env } = context;
  const topics = await getTopics(env, seedData);

  const patchedCount = topics.filter(t => !t.angle).length;
  const patched = topics.map(t => (t.angle ? t : { ...t, angle: 'pain-avoidance' }));

  const existingIds = new Set(patched.map(t => t.id));
  const addedTopics = seedData.topics.filter(t => !existingIds.has(t.id));

  const merged = [...patched, ...addedTopics];
  await saveTopics(env, merged);

  return Response.json({
    totalBefore: topics.length,
    totalAfter: merged.length,
    patchedCount,
    addedCount: addedTopics.length,
    addedIds: addedTopics.map(t => t.id),
  });
}
