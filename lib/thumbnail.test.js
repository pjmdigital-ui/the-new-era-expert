const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildThumbnailTextElement,
  buildThumbnailTextSVG,
  buildFaceLayerElements,
  textLikelyOverflows,
  SAFE_TEXT_WIDTH,
} = require('./thumbnail.js');

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

test('buildThumbnailTextElement defaults to a centered position when no face panel is present', () => {
  const el = buildThumbnailTextElement({ text: 'STOP' });
  assert.ok(el.includes('x="640"'));
  assert.ok(el.includes(`textLength="${SAFE_TEXT_WIDTH}"`));
});

test('buildThumbnailTextElement respects a custom centerX and maxWidth for the face-panel layout', () => {
  const el = buildThumbnailTextElement({ text: 'STOP', centerX: 300, maxWidth: 400 });
  assert.ok(el.includes('x="300"'));
  assert.ok(el.includes('textLength="400"'));
});

test('buildFaceLayerElements throws without base64 or contentType', () => {
  assert.throws(() => buildFaceLayerElements({ contentType: 'image/jpeg', base64: '' }));
  assert.throws(() => buildFaceLayerElements({ base64: 'abc123' }));
});

test('buildFaceLayerElements includes a white backing panel, a clip path, and the embedded image', () => {
  const svg = buildFaceLayerElements({ contentType: 'image/jpeg', base64: 'abc123' });
  assert.ok(svg.includes('fill="#ffffff"'));
  assert.ok(svg.includes('<clipPath'));
  assert.ok(svg.includes('data:image/jpeg;base64,abc123'));
  assert.ok(svg.includes('clip-path='));
});

test('textLikelyOverflows flags long text at a given font size', () => {
  assert.equal(textLikelyOverflows('THIS IS DEFINITELY TOO LONG FOR A THUMBNAIL', 110), true);
  assert.equal(textLikelyOverflows('STOP', 110), false);
});
