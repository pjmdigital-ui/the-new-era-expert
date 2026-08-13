/**
 * Cloudflare Media Transformations — audio extraction (for transcription)
 * and clip cut + vertical crop (for repurposed short-form clips), both
 * driven from R2-sourced video via the MEDIA_TRANSFORM Workers binding.
 * Kept in lib/, like every other storage/binding access point in this
 * repo, so there's one place that knows how to talk to this binding.
 *
 * NOTE: the exact `[media]` wrangler.toml binding shape and minimum
 * wrangler version needed for this feature have not been verified against
 * this repo's actual pinned wrangler version — smoke-test with
 * `wrangler pages dev` before trusting this in production.
 */

// Media Transformations hard-rejects clip durations outside this range —
// see lib/clip-selector.js's clampDuration, which enforces it before any
// AI-selected segment reaches cutAndCropClip.
const MIN_CLIP_DURATION_SECONDS = 1;
const MAX_CLIP_DURATION_SECONDS = 60;

/**
 * @param {{MEDIA: R2Bucket, MEDIA_TRANSFORM: any}} env
 * @param {string} r2Key — source video's key in the MEDIA R2 bucket
 * @returns {Promise<Uint8Array>} AAC-encoded M4A audio bytes
 */
async function extractAudio(env, r2Key) {
  const object = await env.MEDIA.get(r2Key);
  if (!object) {
    throw new Error(`No R2 object at "${r2Key}" to extract audio from`);
  }

  const result = env.MEDIA_TRANSFORM.input(object.body).output({ mode: 'audio' });
  const stream = await result.media();
  return streamToBytes(stream);
}

/**
 * Cuts a clip from the source video and crops it to vertical (9:16),
 * center-weighted ("cover" fit fills the target dimensions by cropping
 * rather than letterboxing).
 *
 * @param {{MEDIA: R2Bucket, MEDIA_TRANSFORM: any}} env
 * @param {string} r2Key
 * @param {{startSeconds: number, durationSeconds: number, width?: number, height?: number}} opts
 * @returns {Promise<Uint8Array>}
 */
async function cutAndCropClip(env, r2Key, opts) {
  const { startSeconds, durationSeconds, width = 1080, height = 1920 } = opts;

  if (durationSeconds < MIN_CLIP_DURATION_SECONDS || durationSeconds > MAX_CLIP_DURATION_SECONDS) {
    throw new Error(
      `Clip duration ${durationSeconds}s is outside Media Transformations' ${MIN_CLIP_DURATION_SECONDS}-${MAX_CLIP_DURATION_SECONDS}s range — clamp before calling cutAndCropClip`
    );
  }

  const object = await env.MEDIA.get(r2Key);
  if (!object) {
    throw new Error(`No R2 object at "${r2Key}" to cut a clip from`);
  }

  const result = env.MEDIA_TRANSFORM.input(object.body)
    .transform({ width, height, fit: 'cover' })
    .output({ time: `${startSeconds}s`, duration: `${durationSeconds}s` });

  const stream = await result.media();
  return streamToBytes(stream);
}

async function streamToBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

module.exports = { MIN_CLIP_DURATION_SECONDS, MAX_CLIP_DURATION_SECONDS, extractAudio, cutAndCropClip, streamToBytes };
