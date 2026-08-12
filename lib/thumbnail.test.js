const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildThumbnailTextSVG, textLikelyOverflows, SAFE_TEXT_WIDTH } = require('./thumbnail.js');

test('buildThumbnailTextSVG throws on empty text rather than silently rendering nothing', () => {
  assert.throws(() => buildThumbnailTextSVG({ text: '' }));
  assert.throws(() => buildThumbnailTextSVG({ text: '   ' }));
});

test('buildThumbnailTextSVG always includes the hard textLength safety constraint', () => {
  const svg = buildThumbnailTextSVG({ text: 'STOP THIS NOW' });
  assert.ok(svg.includes(`textLength="${SAFE_TEXT_WIDTH}"`), 'must always set textLength, not just when text looks long');
  assert.ok(svg.includes('lengthAdjust="spacingAndGlyphs"'));
});

test('buildThumbnailTextSVG escapes XML-unsafe characters', () => {
  const svg = buildThumbnailTextSVG({ text: 'A & B <TEST>' });
  assert.ok(svg.includes('&amp;'));
  assert.ok(svg.includes('&lt;'));
  assert.ok(!svg.includes('<TEST>'));
});

test('textLikelyOverflows flags long text at a given font size', () => {
  assert.equal(textLikelyOverflows('THIS IS DEFINITELY TOO LONG FOR A THUMBNAIL', 110), true);
  assert.equal(textLikelyOverflows('STOP', 110), false);
});
