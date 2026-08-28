/**
 * Generates the on-camera slide deck for a topic — literal spoken-word
 * script, not internal instruction bullets, since Paul reads this straight
 * into the camera. Format mirrors an existing production deck from the
 * sibling Influence Academy system (fetched and inspected directly): full-
 * screen slides, a short headline + a full spoken-word body paragraph per
 * slide. Everything on screen is meant to be read aloud as-is, so there's
 * no separate presenter-only note field — anything generated has to be
 * safe to say out loud.
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_API_VERSION = '2023-06-01';

// What each belief-ladder entry point needs THIS video to accomplish —
// same 7 slugs as lib/topic-discovery.js's ENTRY_POINTS / src/app.js's
// ENTRY_POINT_LABELS. Keeps the generated script's arc tied to the
// content-strategy framework rather than writing a generic script.
const ENTRY_POINT_GOALS = {
  'problem-is-real': 'make the audience feel this problem is real, urgent, and happening to them right now',
  'alternatives-fail': 'show why the alternatives they have already tried do not actually solve this problem',
  'category-exists': 'introduce and legitimize the "knowledge-based tool hub" category as the real solution',
  'credible-and-different': 'establish why this approach is credible and meaningfully different from what is already out there',
  'i-am-capable': 'convince the viewer that they personally are capable of doing this, not just that it is possible in theory',
  'act-now': 'create real urgency — why waiting has a genuine cost and acting now matters',
  'proof-premise-7-8': 'provide concrete proof and evidence that backs up the claims already made',
};

const BUSINESS_CONTEXT = `You are writing an on-camera video script for "The New Era Expert," a YouTube channel that teaches established and aspiring experts (coaches, consultants, course creators, authors, community owners) how to turn their expertise into an AI-powered "knowledge-based tool hub," using MyToolHub as the platform. The brand voice is belief-shift and authority-based — never hustle-framing, never hypey. By the end of the video, the audience needs to understand the category ("knowledge-based tool hub") and hear that MyToolHub is the fastest and easiest way to build one.`;

const SLIDE_DECK_SCHEMA = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['headline', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['slides'],
  additionalProperties: false,
};

/**
 * @param {{title: string, entryPoint: string}} topic
 * @returns {string}
 */
function buildSlideDeckPrompt(topic) {
  const beliefGoal = ENTRY_POINT_GOALS[topic.entryPoint] || 'advance the argument for this video';

  return `${BUSINESS_CONTEXT}

You're writing the on-camera script for this specific video: "${topic.title}"

This video's job in the overall argument is to ${beliefGoal}.

Write this as a literal, word-for-word script broken into 10-14 slides. Every "body" must be the EXACT words the presenter will say out loud into the camera — first person, natural spoken phrasing, contractions, direct address ("you," "your"). This is NOT a set of notes, outline points, or instructions about what to cover — never write things like "explain that..." or "mention how..."; write the actual sentence the presenter says.

Everything you write appears on screen and is spoken verbatim by the presenter — word for word, with nothing else. Never include any note, aside, or commentary about how to deliver a line: no comments on tone, pacing, energy, or performance, whether as a separate note or folded into the body text itself (for example: "calm and direct," "let the words carry it," "no urgency in the voice yet"). If it isn't a sentence the presenter would actually say out loud as part of making their point, do not write it anywhere in the output.

Do not present specific statistics, percentages, dollar figures, or trend claims (e.g. "refund requests are creeping up," "completion rates are falling") as established fact unless they're genuinely well-known and defensible without a citation. Never invent numbers or data-sounding claims just to sound authoritative. If you want to make a point about a trend, describe what the viewer would directly notice or have experienced themselves, rather than citing an unverifiable statistic.

Write in a natural, direct spoken voice. Avoid these AI-generated writing tells:
- Never use the words "quiet" or "quietly" in any form (e.g. "the quiet decline," "happening quietly").
- Never use a reversal/false-contrast construction where you first name what something ISN'T before saying what it IS. This covers every phrasing of the trick, including "it's not X, it's Y," "that's not X, that's Y," "this isn't about X, it's about Y," and the same move split across two sentences, like "I don't think that's X. I think it's Y." State the point directly in one move instead of raising and knocking down a strawman first.

Each slide needs:
- headline: a short, punchy line (a handful of words) that works as an on-screen prompt
- body: the full sentence(s) the presenter actually speaks for this beat — this is what they read

The deck should open with a hook and build the argument to ${beliefGoal} step by step. The FINAL slide must be a direct call to action, not a soft mention: tell the viewer plainly to click the link below and launch their own tool hub in minutes for just one dollar. Say this straightforwardly, in the same spoken voice as the rest of the script — no hype words, no exclamation points — but the specific action ("click the link below") and the specific offer ("launch your own tool hub in minutes, for one dollar") both need to be stated clearly, not implied or vague.`;
}

/**
 * Deterministic, not left to the model — the reference deck picks a font
 * size band per slide based on body length so nothing overflows the
 * viewport. Thresholds are calibrated against that same reference deck's
 * actual slides (short one-liners at ~lg, the typical 200-350 char body at
 * ~md, and the two much longer explanatory paragraphs at ~sm).
 *
 * @param {string} bodyText
 * @returns {'lg'|'md'|'sm'}
 */
function pickSizeBand(bodyText) {
  const length = (bodyText || '').length;
  if (length <= 150) return 'lg';
  if (length <= 400) return 'md';
  return 'sm';
}

/**
 * @param {{title: string, entryPoint: string}} topic
 * @param {string} apiKey
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Array<{headline: string, body: string, size: string}>>}
 */
async function generateSlideDeck(topic, apiKey, fetchFn = fetch) {
  const prompt = buildSlideDeckPrompt(topic);

  const res = await fetchFn(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SLIDE_DECK_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude slide-deck call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to generate a slide deck for this topic');
  }

  const textBlock = (data.content || []).find(block => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude slide-deck response had no text content to parse');
  }

  const parsed = JSON.parse(textBlock.text);
  return (parsed.slides || []).map(slide => ({
    ...slide,
    size: pickSizeBand(slide.body),
  }));
}

module.exports = {
  ENTRY_POINT_GOALS,
  SLIDE_DECK_SCHEMA,
  buildSlideDeckPrompt,
  pickSizeBand,
  generateSlideDeck,
};
