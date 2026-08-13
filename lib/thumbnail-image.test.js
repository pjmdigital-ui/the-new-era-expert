const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildBackgroundPrompt, generateBackgroundImage, NO_TEXT_INSTRUCTION } = require('./thumbnail-image.js');

test('buildBackgroundPrompt always appends the no-text instruction', () => {
  assert.ok(buildBackgroundPrompt('a mountain at sunset').includes(NO_TEXT_INSTRUCTION));
  assert.ok(buildBackgroundPrompt('').includes(NO_TEXT_INSTRUCTION));
  assert.ok(buildBackgroundPrompt(undefined).includes(NO_TEXT_INSTRUCTION));
});

test('generateBackgroundImage decodes the returned base64 image', async () => {
  const originalBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const b64 = Buffer.from(originalBytes).toString('base64');

  const mockFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.prompt.includes(NO_TEXT_INSTRUCTION));
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: b64 }] }),
    };
  };

  const result = await generateBackgroundImage('a mountain at sunset', 'fake-key', mockFetch);
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(Array.from(result.bytes), Array.from(originalBytes));
});

test('generateBackgroundImage throws a readable error on a failed request', async () => {
  const mockFetch = async () => ({ ok: false, status: 400, text: async () => 'bad prompt' });
  await assert.rejects(
    () => generateBackgroundImage('x', 'fake-key', mockFetch),
    /Background image generation failed: 400/
  );
});

test('generateBackgroundImage throws when the response has no image data', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  await assert.rejects(
    () => generateBackgroundImage('x', 'fake-key', mockFetch),
    /no image data/
  );
});
