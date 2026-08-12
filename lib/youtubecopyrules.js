/**
 * Codifies the title/thumbnail/description rules from the brief's Section 4a
 * (the YouTube-native hook framework, NOT the paid-ad-style framework that
 * produced 3.0% CTR / ~20% view duration on the sibling project's early
 * videos). These are meant to be run as a validation pass on whatever an AI
 * generation step produces, not just prose guidance an AI call might drift
 * from over time.
 */

const BANNED_FILLER_WORDS = [
  'SUCCESS', 'SECRETS', 'TIPS', 'TRICKS', 'GUIDE', 'TRUTH',
  'BEST', 'ULTIMATE', 'AMAZING', 'INCREDIBLE', 'POWERFUL',
];

const TITLE_MIN_LENGTH = 40;
const TITLE_MAX_LENGTH = 70;

const THUMBNAIL_TEXT_MIN_WORDS = 2;
const THUMBNAIL_TEXT_MAX_WORDS = 4;
const THUMBNAIL_TEXT_SWEET_SPOT_WORDS = 3;

// Filter-hook openers that gatekeep the viewer instead of delivering the
// payoff immediately — proven to kill CTR/retention on organic YouTube.
const BANNED_OPENER_PATTERNS = [
  /if you'?re (someone who|the (kind|type) of person)/i,
  /this (video|one) is for you if/i,
];

// Stating exact video length reads oddly when the actual runtime differs,
// and adds no persuasive value either way.
const VIDEO_LENGTH_CLAIM_PATTERN = /in the next \d+\s*(minutes?|mins?|seconds?)/i;

/**
 * @param {string} title
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateTitle(title) {
  const issues = [];
  const trimmed = (title || '').trim();

  if (trimmed.length < TITLE_MIN_LENGTH || trimmed.length > TITLE_MAX_LENGTH) {
    issues.push(`Title is ${trimmed.length} chars — target is ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH}.`);
  }

  const upper = trimmed.toUpperCase();
  for (const word of BANNED_FILLER_WORDS) {
    if (upper.includes(word)) {
      issues.push(`Title contains banned filler word: "${word}".`);
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * @param {string} text — the on-image thumbnail text (not the title)
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateThumbnailText(text) {
  const issues = [];
  const trimmed = (text || '').trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  if (wordCount < THUMBNAIL_TEXT_MIN_WORDS || wordCount > THUMBNAIL_TEXT_MAX_WORDS) {
    issues.push(`Thumbnail text is ${wordCount} words — target is ${THUMBNAIL_TEXT_MIN_WORDS}-${THUMBNAIL_TEXT_MAX_WORDS} (${THUMBNAIL_TEXT_SWEET_SPOT_WORDS} is the sweet spot).`);
  }

  if (trimmed !== trimmed.toUpperCase()) {
    issues.push('Thumbnail text should be ALL CAPS.');
  }

  const upper = trimmed.toUpperCase();
  for (const word of BANNED_FILLER_WORDS) {
    if (upper.includes(word)) {
      issues.push(`Thumbnail text contains banned filler word: "${word}".`);
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Checks title + thumbnail text aren't just repeating each other — they're
 * meant to be two different hooks at the same viewer, not one hook twice.
 * @param {string} title
 * @param {string} thumbnailText
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateTitleThumbnailPair(title, thumbnailText) {
  const issues = [];
  const titleWords = new Set((title || '').toLowerCase().match(/\b\w+\b/g) || []);
  const thumbWords = (thumbnailText || '').toLowerCase().match(/\b\w+\b/g) || [];
  const overlap = thumbWords.filter(w => titleWords.has(w));

  if (thumbWords.length > 0 && overlap.length === thumbWords.length) {
    issues.push('Thumbnail text is just a subset of the title — should be a distinct hook, not a repeat.');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Checks any generated spoken/on-screen hook copy for the banned
 * filter-hook opener pattern and the stated-video-length pattern.
 * @param {string} copy
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateHookCopy(copy) {
  const issues = [];
  const text = copy || '';

  for (const pattern of BANNED_OPENER_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Copy uses a filter-hook opener ("${text.match(pattern)[0]}") — deliver the payoff immediately instead.`);
    }
  }

  if (VIDEO_LENGTH_CLAIM_PATTERN.test(text)) {
    issues.push(`Copy states an exact video length ("${text.match(VIDEO_LENGTH_CLAIM_PATTERN)[0]}") — never do this, it reads oddly when wrong.`);
  }

  return { valid: issues.length === 0, issues };
}

module.exports = {
  BANNED_FILLER_WORDS,
  TITLE_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  THUMBNAIL_TEXT_MIN_WORDS,
  THUMBNAIL_TEXT_MAX_WORDS,
  THUMBNAIL_TEXT_SWEET_SPOT_WORDS,
  validateTitle,
  validateThumbnailText,
  validateTitleThumbnailPair,
  validateHookCopy,
};
