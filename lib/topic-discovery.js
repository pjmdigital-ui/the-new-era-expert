/**
 * Real search-driven topic discovery — the rest of the topics slice only
 * re-scores a fixed, hand-written 42-topic list against YouTube demand
 * data; this module actually surfaces NEW candidate topics grounded in
 * what people search for, rather than the belief-ladder premises the
 * seed list was written around.
 *
 * fetchSearchSuggestions hits Google's public YouTube autocomplete
 * endpoint — the most literal available signal for "what people are
 * typing." It's UNOFFICIAL and UNDOCUMENTED (no key, no SLA, could change
 * shape without notice — the same endpoint widely used by YouTube SEO
 * tools like TubeBuddy/VidIQ). functions/api/topics/discover.js falls
 * back automatically to lib/topic-agent.js's officially documented
 * search.list-based fetchYoutubeMatches if this fails.
 */

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_API_VERSION = '2023-06-01';

// The same 7 belief-ladder slugs the existing 42 seed topics use — kept
// in sync with data/seed-topics.json / src/app.js's ENTRY_POINT_LABELS.
// Discovered topics get classified into these, not a new ad hoc category,
// so they stay tied to the existing content-strategy framework.
const ENTRY_POINTS = [
  'problem-is-real',
  'alternatives-fail',
  'category-exists',
  'credible-and-different',
  'i-am-capable',
  'act-now',
  'proof-premise-7-8',
];

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          entryPoint: { type: 'string', enum: ENTRY_POINTS },
          rationale: { type: 'string' },
        },
        required: ['title', 'entryPoint', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
};

/**
 * Fetches YouTube's public search-autocomplete suggestions for a seed
 * query — the literal "what people type" signal. Throws a plain Error on
 * any failure (bad response, unexpected shape) so callers can fall back
 * to a different signal source.
 *
 * @param {string} seedQuery
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string[]>}
 */
async function fetchSearchSuggestions(seedQuery, fetchFn = fetch) {
  const url = `${SUGGEST_URL}?client=firefox&ds=yt&q=${encodeURIComponent(seedQuery)}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`YouTube suggest endpoint failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[1])) {
    throw new Error('YouTube suggest endpoint returned an unexpected shape');
  }
  return data[1];
}

/**
 * @param {string} signalDescription — human-readable label for what kind of signal this is
 * @param {string[]} signalItems — suggestion phrases or competitor video titles
 * @param {string[]} existingTitles — every topic title already on the list, seed or discovered
 * @param {number} count
 * @returns {string}
 */
function buildDiscoveryPrompt(signalDescription, signalItems, existingTitles, count) {
  return `You are helping find new video topic ideas for a YouTube channel ("The New Era Expert") that teaches experts and coaches how to turn their expertise into an AI-powered "knowledge-based tool hub," using MyToolHub as the platform.

${signalDescription}:
${signalItems.map(s => `- ${s}`).join('\n')}

Topics already on the list (do NOT repeat any of these, or a close paraphrase of one):
${existingTitles.map(t => `- ${t}`).join('\n')}

Propose ${count} new, distinct video topic titles genuinely grounded in the signal above. For each one, also pick which belief this topic primarily helps prove (one of: problem-is-real, alternatives-fail, category-exists, credible-and-different, i-am-capable, act-now, proof-premise-7-8), and a short rationale explaining what in the signal above justifies this topic.`;
}

/**
 * @param {{description: string, items: string[]}} signal
 * @param {string[]} existingTitles
 * @param {string} apiKey
 * @param {{count?: number}} [opts]
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Array<{title: string, entryPoint: string, rationale: string}>>}
 */
async function synthesizeCandidateTopics(signal, existingTitles, apiKey, opts = {}, fetchFn = fetch) {
  const { count = 5 } = opts;
  const prompt = buildDiscoveryPrompt(signal.description, signal.items, existingTitles, count);

  const res = await fetchFn(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: CANDIDATE_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude topic-discovery call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to propose topics for this signal');
  }

  const textBlock = (data.content || []).find(block => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude topic-discovery response had no text content to parse');
  }

  const parsed = JSON.parse(textBlock.text);
  return parsed.candidates || [];
}

module.exports = {
  ENTRY_POINTS,
  CANDIDATE_SCHEMA,
  fetchSearchSuggestions,
  buildDiscoveryPrompt,
  synthesizeCandidateTopics,
};
