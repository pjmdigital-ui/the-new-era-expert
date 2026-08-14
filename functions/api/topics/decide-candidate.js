// POST /api/topics/decide-candidate  { id, approved } -> the human review
// gate for discovered topics. approved:true joins the main ranked list
// (status:'active'); approved:false is kept as status:'rejected' — not
// deleted — so an accidental approve-then-regret isn't a silent data loss,
// and so future /api/topics/discover runs can avoid re-suggesting it.

const { rankTopics } = require('../../../lib/topic-ranker.js');
const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const seedData = require('../../../data/seed-topics.json');

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { id, approved } = body;

  if (!id || typeof approved !== 'boolean') {
    return Response.json({ error: 'id and a boolean approved are required' }, { status: 400 });
  }

  const topics = await getTopics(env, seedData);
  if (!topics.some(t => t.id === id)) {
    return Response.json({ error: `No topic with id "${id}"` }, { status: 404 });
  }

  const updated = topics.map(t =>
    t.id === id ? { ...t, status: approved ? 'active' : 'rejected' } : t
  );
  await saveTopics(env, updated);

  const ranked = rankTopics(updated.filter(t => !t.status || t.status === 'active'));
  const candidates = updated.filter(t => t.status === 'candidate');
  return Response.json({ topics: ranked, nextUp: ranked[0] || null, candidates });
}
