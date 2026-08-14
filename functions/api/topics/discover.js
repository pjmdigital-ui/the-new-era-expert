// POST /api/topics/discover -> surfaces NEW candidate topics grounded in
// real search signal (YouTube autocomplete, with an automatic fallback to
// the officially documented search.list) rather than the fixed 42-topic
// belief-ladder seed list. New topics are appended with status:'candidate'
// and need a human decision via /api/topics/decide-candidate before they
// join the ranked list — see index.js's status filter.

const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const { scoreTopic, fetchYoutubeMatches } = require('../../../lib/topic-agent.js');
const { fetchSearchSuggestions, synthesizeCandidateTopics } = require('../../../lib/topic-discovery.js');
const seedData = require('../../../data/seed-topics.json');

// Plain, easily-edited seed phrases drawn from the language already used
// across the 42 existing seed topics — not hidden logic. Revisit as the
// content strategy evolves.
const SEED_QUERIES = [
  'knowledge based tool hub',
  'AI course creator',
  'coaching business AI',
  'turn expertise into AI tool',
  'course creator AI disruption',
  'build a knowledge base for clients',
  'AI powered coaching business',
  'productize expertise with AI',
];

const CANDIDATES_PER_RUN = 5;

export async function onRequestPost(context) {
  const { env } = context;

  if (!env.CLAUDE_API_KEY) {
    return Response.json(
      { error: 'CLAUDE_API_KEY is not configured — set it via `wrangler pages secret put CLAUDE_API_KEY`' },
      { status: 500 }
    );
  }

  const topics = await getTopics(env, seedData);
  const existingTitles = topics.map(t => t.title);

  const signal = await gatherSignal(env);

  const synthesized = await synthesizeCandidateTopics(
    signal,
    existingTitles,
    env.CLAUDE_API_KEY,
    { count: CANDIDATES_PER_RUN }
  );

  const newCandidates = await Promise.all(
    synthesized.map(async candidate => {
      const demandScore = env.YOUTUBE_DATA_API_KEY
        ? await scoreTopic({ title: candidate.title }, env.YOUTUBE_DATA_API_KEY).catch(() => 0)
        : 0;
      return {
        id: crypto.randomUUID(),
        title: candidate.title,
        entryPoint: candidate.entryPoint,
        rationale: candidate.rationale,
        status: 'candidate',
        source: 'discovered',
        timesCovered: 0,
        demandScore,
        lastCoveredAt: null,
      };
    })
  );

  await saveTopics(env, [...topics, ...newCandidates]);

  return Response.json({ candidates: newCandidates, signalSource: signal.source });
}

// Tries the literal "what people search for" signal first (Google's public
// YouTube autocomplete endpoint); falls back to the officially documented
// search.list-based signal (already-integrated, same YOUTUBE_DATA_API_KEY)
// if the unofficial suggest endpoint fails for every seed query.
async function gatherSignal(env) {
  const suggestResults = await Promise.allSettled(SEED_QUERIES.map(q => fetchSearchSuggestions(q)));
  const suggestions = suggestResults.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  if (suggestions.length > 0) {
    return {
      source: 'youtube-autocomplete',
      description: 'Real YouTube search-autocomplete suggestions for related seed queries',
      items: [...new Set(suggestions)].slice(0, 40),
    };
  }

  if (!env.YOUTUBE_DATA_API_KEY) {
    throw new Error(
      'YouTube autocomplete failed and YOUTUBE_DATA_API_KEY is not configured for the fallback — ' +
        'set it via `wrangler pages secret put YOUTUBE_DATA_API_KEY`'
    );
  }

  const matchResults = await Promise.allSettled(SEED_QUERIES.map(q => fetchYoutubeMatches(q, env.YOUTUBE_DATA_API_KEY)));
  const titles = matchResults.filter(r => r.status === 'fulfilled').flatMap(r => r.value.map(v => v.title));

  if (titles.length === 0) {
    throw new Error('Both the YouTube autocomplete signal and the search.list fallback failed to produce any results');
  }

  return {
    source: 'youtube-search-list',
    description: 'Titles of real competitor videos currently ranking for related seed queries',
    items: [...new Set(titles)].slice(0, 40),
  };
}
