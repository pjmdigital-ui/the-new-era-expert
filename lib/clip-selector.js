/**
 * Picks compelling, self-contained clip moments from a timestamped
 * transcript via the Claude Messages API (structured JSON output), for
 * talking-head footage where clip-worthy moments have to come from what's
 * actually said — unlike the AI-rendered sibling project, there are no
 * pre-known scene markers to key off.
 *
 * clampDuration is pure and hard-clamps every segment into
 * lib/media-transform.js's [MIN,MAX] clip-duration range — Media
 * Transformations rejects anything outside it, so the model's raw output
 * is never trusted directly.
 */

const { MIN_CLIP_DURATION_SECONDS, MAX_CLIP_DURATION_SECONDS } = require('./media-transform.js');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-opus-5';
const CLAUDE_API_VERSION = '2023-06-01';

const CLIP_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSeconds: { type: 'number' },
          endSeconds: { type: 'number' },
          reason: { type: 'string' },
          transcriptExcerpt: { type: 'string' },
          captions: {
            type: 'object',
            properties: {
              tiktok: { type: 'string' },
              instagram: { type: 'string' },
              linkedin: { type: 'string' },
            },
            required: ['tiktok', 'instagram', 'linkedin'],
            additionalProperties: false,
          },
        },
        required: ['startSeconds', 'endSeconds', 'reason', 'transcriptExcerpt', 'captions'],
        additionalProperties: false,
      },
    },
  },
  required: ['clips'],
  additionalProperties: false,
};

/**
 * Hard-clamps a model-proposed segment into Media Transformations' allowed
 * clip-duration range. Never trust the raw startSeconds/endSeconds gap.
 *
 * @param {{startSeconds: number, endSeconds: number}} segment
 * @returns {{startSeconds: number, durationSeconds: number}}
 */
function clampDuration(segment) {
  const startSeconds = Math.max(0, Number(segment.startSeconds) || 0);
  let duration = Number(segment.endSeconds) - Number(segment.startSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = MIN_CLIP_DURATION_SECONDS;
  }
  duration = Math.min(MAX_CLIP_DURATION_SECONDS, Math.max(MIN_CLIP_DURATION_SECONDS, duration));

  return { ...segment, startSeconds, durationSeconds: duration };
}

/**
 * @param {string} transcript — timestamped transcript text
 * @param {number} [count]
 * @returns {string}
 */
function buildClipSelectionPrompt(transcript, count = 4) {
  return `Here is a timestamped transcript of a talking-head video:

${transcript}

Select ${count} self-contained, hook-worthy segments (15-60 seconds each) that would work as standalone short-form clips for TikTok, Instagram Reels, and LinkedIn. Each segment must make sense without any context from the rest of the video — no "as I mentioned before" or dangling references.

For each segment, provide:
- startSeconds / endSeconds (numbers, matching the transcript's timestamps)
- reason: why this specific moment is compelling as a standalone clip
- transcriptExcerpt: the exact words spoken in this segment
- captions: platform-specific captions for tiktok, instagram, and linkedin`;
}

/**
 * @param {string} transcript
 * @param {string} apiKey
 * @param {{count?: number}} [opts]
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Array<{startSeconds: number, durationSeconds: number, reason: string, transcriptExcerpt: string, captions: {tiktok: string, instagram: string, linkedin: string}}>>}
 */
async function selectClipCandidates(transcript, apiKey, opts = {}, fetchFn = fetch) {
  const { count = 4 } = opts;
  const prompt = buildClipSelectionPrompt(transcript, count);

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
        format: { type: 'json_schema', schema: CLIP_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude clip-selection call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to select clips for this transcript');
  }

  const textBlock = (data.content || []).find(block => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude clip-selection response had no text content to parse');
  }

  const parsed = JSON.parse(textBlock.text);
  return (parsed.clips || []).map(clampDuration);
}

module.exports = { CLIP_SCHEMA, clampDuration, buildClipSelectionPrompt, selectClipCandidates };
