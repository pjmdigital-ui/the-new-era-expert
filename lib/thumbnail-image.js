/**
 * AI background image generation for thumbnails. Per lib/thumbnail.js's
 * documented constraint, the model only ever generates the background —
 * real on-image text is drawn separately in code (thumbnail-render.js) —
 * so every prompt sent here always carries an explicit no-text instruction,
 * regardless of what the caller passes in.
 *
 * Vendor note: IMAGE_GEN_API_KEY has no vendor precedent anywhere else in
 * this codebase. This wraps OpenAI's Images API (gpt-image-1) as a
 * concrete, swappable default — change buildBackgroundPrompt's fetch target
 * and response parsing if a different provider is intended.
 */

const IMAGE_API_URL = 'https://api.openai.com/v1/images/generations';
const NO_TEXT_INSTRUCTION =
  'Do not render any text, letters, words, captions, or typography anywhere in the image.';

/**
 * @param {string} [prompt]
 * @returns {string}
 */
function buildBackgroundPrompt(prompt) {
  const base = (prompt || '').trim();
  return base ? `${base}. ${NO_TEXT_INSTRUCTION}` : NO_TEXT_INSTRUCTION;
}

/**
 * @param {string} prompt
 * @param {string} apiKey
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{bytes: Uint8Array, contentType: string}>}
 */
async function generateBackgroundImage(prompt, apiKey, fetchFn = fetch) {
  const finalPrompt = buildBackgroundPrompt(prompt);

  const res = await fetchFn(IMAGE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: finalPrompt,
      // Closest supported size to the 1280x720 (16:9) thumbnail canvas.
      size: '1536x1024',
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    throw new Error(`Background image generation failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    throw new Error('Image generation response had no image data');
  }

  return { bytes: base64ToBytes(b64), contentType: 'image/png' };
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

module.exports = { NO_TEXT_INSTRUCTION, buildBackgroundPrompt, generateBackgroundImage };
