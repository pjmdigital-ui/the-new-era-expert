const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishClip, waitForContainerReady } = require('./instagram-publish.js');

test('waitForContainerReady returns immediately when the container is already FINISHED', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ status_code: 'FINISHED' }) });
  await waitForContainerReady('token', 'creation-1', mockFetch, { pollIntervalMs: 0 });
});

test('waitForContainerReady polls until FINISHED, with no real delay when pollIntervalMs is 0', async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ status_code: calls < 3 ? 'IN_PROGRESS' : 'FINISHED' }) };
  };
  await waitForContainerReady('token', 'creation-1', mockFetch, { pollIntervalMs: 0, maxPollAttempts: 10 });
  assert.equal(calls, 3);
});

test('waitForContainerReady throws when Instagram reports an ERROR status', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ status_code: 'ERROR' }) });
  await assert.rejects(
    () => waitForContainerReady('token', 'creation-1', mockFetch, { pollIntervalMs: 0 }),
    /failed to process/
  );
});

test('waitForContainerReady gives up after maxPollAttempts', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ status_code: 'IN_PROGRESS' }) });
  await assert.rejects(
    () => waitForContainerReady('token', 'creation-1', mockFetch, { pollIntervalMs: 0, maxPollAttempts: 3 }),
    /did not finish processing after 3 polls/
  );
});

test('publishClip creates a container, waits, then publishes and returns the media id', async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return { ok: true, json: async () => ({ id: 'container-1' }) };
    if (calls.length === 2) return { ok: true, json: async () => ({ status_code: 'FINISHED' }) };
    return { ok: true, json: async () => ({ id: 'media-99' }) };
  };

  const result = await publishClip(
    'access-token',
    'ig-user-1',
    'https://media.example/clips/x.mp4',
    'my caption',
    mockFetch,
    { pollIntervalMs: 0 }
  );

  assert.deepEqual(result, { mediaId: 'media-99' });
  assert.ok(calls[0].url.includes('/ig-user-1/media'));
  const createBody = JSON.parse(calls[0].init.body);
  assert.equal(createBody.video_url, 'https://media.example/clips/x.mp4');
  assert.equal(createBody.caption, 'my caption');
  assert.ok(calls[2].url.includes('/ig-user-1/media_publish'));
});

test('publishClip throws a readable error when container creation fails', async () => {
  const mockFetch = async () => ({ ok: false, status: 400, text: async () => 'bad request' });
  await assert.rejects(
    () => publishClip('token', 'ig-user-1', 'https://x/y.mp4', 'caption', mockFetch, { pollIntervalMs: 0 }),
    /Instagram media container creation failed: 400/
  );
});
