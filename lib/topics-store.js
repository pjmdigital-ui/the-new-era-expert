/**
 * Shared KV read/write for topic data — the single source of truth
 * referenced from every functions/api/topics/*.js route. Kept in lib/
 * (not functions/) specifically so it's never mistaken for a route itself.
 *
 * Per the brief's Section 4b warning: every place that reads or writes
 * topic data must go through these two functions, against the same KV
 * key, so the dashboard's preview and any automated picker never drift
 * out of sync with two different copies of the data.
 */

const KV_KEY = 'topics:all';

async function getTopics(env, seedData) {
  const stored = await env.CONTENT_KV.get(KV_KEY, 'json');
  if (stored && Array.isArray(stored) && stored.length > 0) return stored;
  // First-ever load: seed from the framework, persist immediately so this
  // fallback only ever happens once.
  await env.CONTENT_KV.put(KV_KEY, JSON.stringify(seedData.topics));
  return seedData.topics;
}

async function saveTopics(env, topics) {
  await env.CONTENT_KV.put(KV_KEY, JSON.stringify(topics));
}

module.exports = { KV_KEY, getTopics, saveTopics };
