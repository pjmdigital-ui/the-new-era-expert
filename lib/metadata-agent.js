/**
 * AI title/description/thumbnail-text generation via the Claude Messages
 * API — uses structured JSON output (output_config.format) so the response
 * is always valid JSON matching the requested schema, rather than relying
 * on prompt-level JSON coaxing or brittle regex extraction.
 *
 * Design mirrors lib/topic-agent.js: the network call (callClaude) is
 * separated from the pure prompt-building (buildMetadataPrompt) and the
 * retry/validation orchestration (generateValidatedOptions), and fetchFn is
 * injectable so the whole pipeline is testable without a real API key.
 *
 * The prompt encodes Paul's own YouTube growth/copywriting framework
 * (elite-strategist voice, curiosity-driven titles, pattern-interrupt
 * thumbnail text, a structured hook -> value -> audience -> CTA ->
 * resource -> SEO description) rather than a generic "write a title"
 * instruction, which is what was producing bland, context-free copy.
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_API_VERSION = '2023-06-01';

const { validateTitle, validateThumbnailText } = require('./youtube-copy-rules.js');

const BUSINESS_CONTEXT = `"The New Era Expert" is a YouTube channel that teaches established and aspiring experts (coaches, consultants, course creators, authors, community owners) how to turn their expertise into an AI-powered "knowledge-based tool hub," using MyToolHub (mytoolhub.ai) as the platform.`;

// Deliberately no minItems/minLength — the Messages API's structured-output
// JSON Schema support does not accept those constraints (see the numeric/
// string/array constraint limitations in the Claude API docs); length and
// count requirements are stated in the prompt instead and enforced by the
// validation pass below, not by the schema.
const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    titleOptions: { type: 'array', items: { type: 'string' } },
    descriptionOptions: { type: 'array', items: { type: 'string' } },
    thumbnailTextOptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['titleOptions', 'descriptionOptions', 'thumbnailTextOptions'],
  additionalProperties: false,
};

/**
 * @param {{topicTitle?: string, filename?: string}} context
 * @param {string[]|null} [feedback] — validation issues from a prior attempt,
 *   fed back so a retry can correct them rather than repeating the same mistakes.
 * @returns {string}
 */
function buildMetadataPrompt(context, feedback) {
  const subject = (context && (context.topicTitle || context.filename)) || 'this video';
  const feedbackBlock =
    feedback && feedback.length
      ? `\n\nThe previous attempt had these issues — fix them this time:\n${feedback.map(f => `- ${f}`).join('\n')}`
      : '';

  return `You are an elite YouTube growth strategist, CTR optimization expert, and direct-response copywriter. You specialize in persuasion psychology, curiosity-driven messaging, and modern YouTube packaging strategy. You understand the difference between thumbnail messaging (pattern interrupt + emotion), video titles (clarity + curiosity + SEO benefit), and descriptions (retention + conversion + algorithm signals). You never write generic or bland YouTube packaging.

${BUSINESS_CONTEXT}

Generate YouTube metadata for a video about: ${subject}

1. TITLES — 6 options, ordered strongest first. Each title must:
- create curiosity
- promise a clear benefit or transformation
- be conversational and feel native to YouTube, not corporate
- include natural keyword relevance
- avoid clickbait exaggeration
- be 40-70 characters
- never use these words: SUCCESS, SECRETS, TIPS, TRICKS, GUIDE, TRUTH, BEST, ULTIMATE, AMAZING, INCREDIBLE, POWERFUL

2. THUMBNAIL TEXT — 6 options, ordered strongest first. Each option must:
- be 2-4 words (3 is the sweet spot)
- be short, emotionally charged, and pattern-interrupting — easy to read on mobile at a glance
- NOT repeat the video title — it's a second, distinct hook, not the same hook twice
- focus on tension, curiosity, or outcome
- be ALL CAPS
- never use the banned words listed above

3. DESCRIPTIONS — 2 full options. Each must be a single string built from these sections, in this order, separated by a blank line:
- Hook paragraph: open with intrigue or tension that makes the viewer feel compelled to keep watching
- Value preview: 3-5 lines, each starting with "•", showing specifically what the viewer will learn or gain
- Who this is for: one short paragraph naming the audience and why this matters to them right now
- Call to action: one short paragraph persuading the viewer to subscribe and engage — persuasion, not a bare command list
- Resource line: one line pointing to mytoolhub.ai as where to actually go build a knowledge-based tool hub
- Keyword paragraph: one natural-language paragraph, written like normal prose, that naturally works in relevant search terms — never a comma-separated keyword dump

Tone throughout: confident, clear, energetic, persuasive, conversational, expert-driven. Never robotic or corporate.

Avoid these AI-generated writing tells in everything you write:
- Never use a reversal/false-contrast construction where you first name what something ISN'T before saying what it IS — this includes "it's not X, it's Y," "that's not X, that's Y," and the same move split across two sentences like "I don't think that's X. I think it's Y." State the point directly instead.
- Never use the words "quiet" or "quietly" in any form.
- Never present a specific statistic, percentage, or data-sounding claim as established fact unless it's genuinely well-known and defensible without a citation — never invent numbers just to sound authoritative.
- Avoid hype clichés, generic motivational language, keyword stuffing, and long complex sentences.${feedbackBlock}`;
}

/**
 * @param {string} prompt
 * @param {string} apiKey
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{titleOptions: string[], descriptionOptions: string[], thumbnailTextOptions: string[]}>}
 */
async function callClaude(prompt, apiKey, fetchFn = fetch) {
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
      // Thinking off + medium effort: this is short-form copywriting, not
      // multi-step reasoning — adaptive thinking's default-on behavior on
      // this model would add latency/cost with no quality benefit here.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: METADATA_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to generate metadata for this request');
  }

  const textBlock = (data.content || []).find(block => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude response had no text content to parse');
  }

  return JSON.parse(textBlock.text);
}

/**
 * Orchestrates generation with a validate-and-retry loop against the
 * existing youtube-copy-rules.js validators. Never hard-fails — after
 * maxAttempts it returns whatever the last attempt produced plus a
 * warnings list, since a human reviews the options before select.js locks
 * anything in.
 *
 * @param {{topicTitle?: string, filename?: string}} context
 * @param {string} apiKey
 * @param {{maxAttempts?: number, fetchFn?: typeof fetch}} [opts]
 */
async function generateValidatedOptions(context, apiKey, opts = {}) {
  const { maxAttempts = 3, fetchFn = fetch } = opts;

  let lastResult = null;
  let issues = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildMetadataPrompt(context, attempt > 1 ? issues : null);
    const result = await callClaude(prompt, apiKey, fetchFn);
    lastResult = result;

    const validTitles = (result.titleOptions || []).filter(t => validateTitle(t).valid);
    const validThumbnailTexts = (result.thumbnailTextOptions || []).filter(
      t => validateThumbnailText(t).valid
    );

    if (validTitles.length >= 2 && validThumbnailTexts.length >= 1) {
      return {
        titleOptions: result.titleOptions,
        descriptionOptions: result.descriptionOptions,
        thumbnailTextOptions: result.thumbnailTextOptions,
        validation: { attempts: attempt, warnings: [] },
      };
    }

    issues = [];
    for (const t of result.titleOptions || []) issues.push(...validateTitle(t).issues);
    for (const t of result.thumbnailTextOptions || []) issues.push(...validateThumbnailText(t).issues);
  }

  return {
    titleOptions: lastResult.titleOptions,
    descriptionOptions: lastResult.descriptionOptions,
    thumbnailTextOptions: lastResult.thumbnailTextOptions,
    validation: { attempts: maxAttempts, warnings: issues },
  };
}

module.exports = {
  CLAUDE_MODEL,
  METADATA_SCHEMA,
  BUSINESS_CONTEXT,
  buildMetadataPrompt,
  callClaude,
  generateValidatedOptions,
};
