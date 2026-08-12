const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTitle,
  validateThumbnailText,
  validateTitleThumbnailPair,
  validateHookCopy,
} = require('./youtube-copy-rules.js');

test('validateTitle rejects banned filler words', () => {
  const result = validateTitle('The Ultimate Secrets To Growing Your Coaching Business Fast Today');
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.includes('ULTIMATE')));
  assert.ok(result.issues.some(i => i.includes('SECRETS')));
});

test('validateTitle rejects titles outside the length window', () => {
  const short = validateTitle('Too short');
  assert.equal(short.valid, false);
  const good = validateTitle('Why Your Opt-In Rates Are Quietly Dropping (And How To Fix It Fast)');
  assert.equal(good.valid, true);
});

test('validateThumbnailText enforces word count, all-caps, and no filler words', () => {
  const tooMany = validateThumbnailText('THIS IS WAY TOO MANY WORDS FOR A THUMBNAIL');
  assert.equal(tooMany.valid, false);

  const notCaps = validateThumbnailText('this should be caps');
  assert.equal(notCaps.valid, false);

  const good = validateThumbnailText('STOP DOING THIS');
  assert.equal(good.valid, true);
});

test('validateTitleThumbnailPair flags a thumbnail that just repeats the title', () => {
  const result = validateTitleThumbnailPair(
    'Why Your Opt-In Rates Are Dropping',
    'OPT-IN RATES'
  );
  assert.equal(result.valid, false);
});

test('validateTitleThumbnailPair allows a distinct second hook', () => {
  const result = validateTitleThumbnailPair(
    'Why Your Opt-In Rates Are Dropping',
    'STOP THIS NOW'
  );
  assert.equal(result.valid, true);
});

test('validateHookCopy rejects filter-hook openers', () => {
  const result = validateHookCopy("If you're someone who has been struggling with this...");
  assert.equal(result.valid, false);
});

test('validateHookCopy rejects stated exact video length', () => {
  const result = validateHookCopy("In the next 12 minutes I'll show you exactly how.");
  assert.equal(result.valid, false);
});

test('validateHookCopy passes clean copy', () => {
  const result = validateHookCopy('Your opt-in rate dropped because of one setting. Here it is.');
  assert.equal(result.valid, true);
});
