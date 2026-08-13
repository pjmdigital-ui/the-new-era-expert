const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCaptions } = require('./caption-writer.js');

test('validateCaptions passes clean captions on all three platforms', () => {
  const result = validateCaptions({
    tiktok: 'Here is exactly why this matters right now.',
    instagram: 'Here is exactly why this matters right now.',
    linkedin: 'Here is exactly why this matters right now.',
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test('validateCaptions flags a banned filter-hook opener, prefixed with the platform', () => {
  const result = validateCaptions({
    tiktok: "If you're the kind of person who wants results, watch this.",
    instagram: 'A normal caption.',
    linkedin: 'A normal caption.',
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.startsWith('tiktok:')));
});

test('validateCaptions flags a stated video length claim', () => {
  const result = validateCaptions({
    tiktok: 'A normal caption.',
    instagram: 'In the next 3 minutes I will show you everything.',
    linkedin: 'A normal caption.',
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.startsWith('instagram:')));
});

test('validateCaptions handles a missing platform key without throwing', () => {
  const result = validateCaptions({ tiktok: 'fine' });
  assert.equal(typeof result.valid, 'boolean');
});
