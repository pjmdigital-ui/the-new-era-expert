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

// Every query below was validated live against the actual YouTube
// autocomplete endpoint (gatherSignal's fetchSearchSuggestions) across
// three research passes (116 candidates tested total) -- not guessed. Two
// things learned doing that: (1) full symptom SENTENCES ("why isn't my
// course selling", "course sales are declining") mostly return nothing --
// autocomplete completes a short root, it doesn't match an already-
// finished sentence -- though a few short symptom sentences DO work
// ("why is my conversion rate" -> "...so low"). (2) some plausible-
// looking roots collide with unrelated meanings and return noise, not
// signal: "cpm"/"roas" as bare roots matched heart-rate "bpm" and "pot
// roast"; "community engagement"/"student engagement" have real volume
// but it's all K-12/HR/government content, not this audience; most
// "ai for X sites/communities/chatbot" phrasings returned nothing.
//
// The list below intentionally mixes two angles (see lib/topic-discovery
// .js's ANGLES) -- pain-avoidance and pleasure-seeking -- each labeled by
// section. It skewed 100% pain-avoidance until 2026-08-28.
const SEED_QUERIES = [
  // Ad/traffic pain -- "why are my ads" (not converting/not spending) works
  // far better as platform-specific roots than as one generic phrase.
  'why are my facebook ads',
  'why are my instagram ads',
  'facebook ads cost',
  'cost per lead',

  // Sales/conversion pain
  'sales page conversion',
  'webinar conversion',
  'why is my conversion rate',
  'evergreen funnel',

  // Audience identity -- broadened beyond "coaching" to the channel's full
  // stated audience (consultants, authors, membership/community owners,
  // info-product creators).
  'coaching business',
  'consulting business',
  'author business',
  'membership site',
  'info product business',

  // Scaling / burnout pain -- the 1:1-doesn't-scale problem a tool hub
  // directly solves.
  'scale your coaching business',
  'stop trading time for money',

  // The expertise-to-product transition itself
  'productize your expertise',
  'monetize your expertise',
  'turn your knowledge into income',

  // AI-aware solution search -- people already looking for the kind of
  // thing MyToolHub is.
  'AI course creator',
  'ai for coaches',
  'ai for consultants',
  'ai for authors',
  'how to build an ai tool',
  'how to build a custom gpt',
  'sell access to an ai',

  // Pleasure-seeking / opportunity roots -- validated 2026-08-28 against
  // the same live autocomplete endpoint (34 candidates tested). Added
  // because the list above skewed entirely pain-avoidance; a real audience
  // also searches AI from a leverage/monetization/optimization angle, not
  // just a symptom angle. Dead ends found this pass, worth remembering:
  // "ai side hustle"/"ai passive income"/"ai wealth"/"ai freedom"/"ai
  // income"/"chatgpt side hustle"/"make passive income with ai" are all
  // dominated by generic make-money-online/guru-funnel content (crypto
  // arbitrage, Airbnb, teen side-hustle content, named guru products like
  // "AI Freedom Launchpad") -- real volume, wrong audience, not used.
  // "ai agency" is dominated by cold-call/sales-training content for
  // running an AI-services agency -- a different business model than
  // packaging your own expertise, not used. "optimize your business with
  // ai" returned nothing; "turn your skills into ai" only matched the
  // unrelated "turn yourself into ai" avatar trend; "ai productivity" and
  // "ai lifestyle business" returned generic productivity-tool volume with
  // no clear tie to monetizing expertise -- not used.
  'how to leverage ai in your business',
  'how to scale your business with ai',
  'ai tools for entrepreneurs',
  'build an ai business',
  'sell ai tools',
  'ai product ideas',
  'how to make an ai product',
  'grow your business with ai',
  'custom gpt business',
  'ai automation business',
  'ai course business',
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
        angle: candidate.angle,
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
