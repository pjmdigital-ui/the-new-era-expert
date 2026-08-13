/**
 * Validates AI-generated platform captions against the existing
 * validateHookCopy rules (banned filter-hook openers, no stated video
 * length) — the same rules that already apply to long-form hook copy also
 * apply to short-form captions. Caption *generation* happens as part of
 * lib/clip-selector.js's single Claude call (reusing that call rather than
 * a separate one per clip) — this module is the validation pass over that
 * output, run before a clip is staged in the approval queue.
 */

const { validateHookCopy } = require('./youtube-copy-rules.js');

const PLATFORMS = ['tiktok', 'instagram', 'linkedin'];

/**
 * @param {{tiktok: string, instagram: string, linkedin: string}} captions
 * @returns {{valid: boolean, issues: string[]}}
 */
function validateCaptions(captions) {
  const issues = [];
  for (const platform of PLATFORMS) {
    const result = validateHookCopy((captions && captions[platform]) || '');
    for (const issue of result.issues) {
      issues.push(`${platform}: ${issue}`);
    }
  }
  return { valid: issues.length === 0, issues };
}

module.exports = { PLATFORMS, validateCaptions };
