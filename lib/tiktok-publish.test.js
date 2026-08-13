const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishClip } = require('./tiktok-publish.js');

test('publishClip inits then PUTs the stream directly (not buffered) and returns the publish id', async () => {
  const fakeStream = { marker: 'clip-bytes' };
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return {
        ok: true,
        json: async () => ({ data: { upload_url: 'https://tiktok.example/upload/abc', publish_id: 'pub-123' } }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishClip('access-token', fakeStream, 'my caption', { sizeBytes: 500 }, mockFetch);
  assert.deepEqual(result, { publishId: 'pub-123' });

  assert.equal(calls[0].init.headers.authorization, 'Bearer access-token');
  const initBody = JSON.parse(calls[0].init.body);
  assert.equal(initBody.post_info.title, 'my caption');
  assert.equal(initBody.source_info.video_size, 500);

  assert.equal(calls[1].url, 'https://tiktok.example/upload/abc');
  assert.equal(calls[1].init.method, 'PUT');
  assert.strictEqual(calls[1].init.body, fakeStream, 'must pass the stream through directly, never buffer it');
});

test('publishClip throws a readable error when init fails', async () => {
  const mockFetch = async () => ({ ok: false, status: 401, text: async () => 'invalid token' });
  await assert.rejects(
    () => publishClip('bad-token', {}, 'caption', { sizeBytes: 1 }, mockFetch),
    /TikTok publish init failed: 401/
  );
});

test('publishClip throws when the init response is missing upload_url/publish_id', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ data: {} }) });
  await assert.rejects(
    () => publishClip('token', {}, 'caption', { sizeBytes: 1 }, mockFetch),
    /no upload_url\/publish_id/
  );
});

test('publishClip throws a readable error when the upload PUT fails', async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls++;
    if (calls === 1) {
      return { ok: true, json: async () => ({ data: { upload_url: 'https://x', publish_id: 'p' } }) };
    }
    return { ok: false, status: 500, text: async () => 'upload failed' };
  };
  await assert.rejects(
    () => publishClip('token', {}, 'caption', { sizeBytes: 1 }, mockFetch),
    /TikTok clip upload failed: 500/
  );
});
