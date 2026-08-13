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
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_API_VERSION = '2023-06-01';

const { validateTitle, validateThumbnailText } = require('./youtube-copy-rules.js');

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

  return `Generate YouTube metadata options for a video about: ${subject}

Produce:
- 4 title options, each 40-70 characters, no filler words like "SECRETS", "TIPS", "ULTIMATE", "BEST", "GUIDE", "TRUTH", "SUCCESS", "TRICKS", "AMAZING", "INCREDIBLE", "POWERFUL"
- 2 description options, 2-3 sentences each, written for a knowledge-based tool hub / AI-powered expertise audience
- 3 thumbnail text options, each 2-4 words (3 is the sweet spot), ALL CAPS, no filler words from the list above${feedbackBlock}`;
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
      max_tokens: 2048,
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
  buildMetadataPrompt,
  callClaude,
  generateValidatedOptions,
};
