const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startResumableUpload, uploadVideoBytes, setThumbnail } = require('./youtube-publish.js');

test('startResumableUpload posts snippet/status and returns the Location header', async () => {
  let seenUrl, seenInit;
  const mockFetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return {
      ok: true,
      headers: { get: name => (name === 'location' ? 'https://upload.example/session-123' : null) },
    };
  };

  const uploadUrl = await startResumableUpload(
    { title: 'My Title', description: 'Desc', categoryId: '27', privacyStatus: 'private' },
    12345,
    'video/mp4',
    'access-token',
    mockFetch
  );

  assert.equal(uploadUrl, 'https://upload.example/session-123');
  assert.ok(seenUrl.includes('uploadType=resumable'));
  assert.equal(seenInit.headers.authorization, 'Bearer access-token');
  assert.equal(seenInit.headers['x-upload-content-length'], '12345');
  assert.equal(seenInit.headers['x-upload-content-type'], 'video/mp4');
  const body = JSON.parse(seenInit.body);
  assert.equal(body.snippet.title, 'My Title');
  assert.equal(body.status.privacyStatus, 'private');
});

test('startResumableUpload throws when the response has no Location header', async () => {
  const mockFetch = async () => ({ ok: true, headers: { get: () => null } });
  await assert.rejects(
    () => startResumableUpload({ title: 't', description: 'd', categoryId: '27', privacyStatus: 'private' }, 1, 'video/mp4', 'tok', mockFetch),
    /no Location header/
  );
});

test('startResumableUpload throws a readable error on a failed request', async () => {
  const mockFetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(
    () => startResumableUpload({ title: 't', description: 'd', categoryId: '27', privacyStatus: 'private' }, 1, 'video/mp4', 'tok', mockFetch),
    /Failed to start YouTube resumable upload: 403/
  );
});

test('uploadVideoBytes PUTs the stream directly (not buffered) and returns the video id', async () => {
  const fakeStream = { marker: 'this-is-the-stream' };
  let seenInit;
  const mockFetch = async (url, init) => {
    seenInit = init;
    return { ok: true, json: async () => ({ id: 'yt-video-id-123' }) };
  };

  const result = await uploadVideoBytes('https://upload.example/session-123', fakeStream, 999, 'video/mp4', mockFetch);
  assert.deepEqual(result, { videoId: 'yt-video-id-123' });
  assert.equal(seenInit.method, 'PUT');
  assert.strictEqual(seenInit.body, fakeStream, 'must pass the stream through directly, never buffer it');
  assert.equal(seenInit.headers['content-length'], '999');
});

test('uploadVideoBytes throws a readable error on a failed upload', async () => {
  const mockFetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
  await assert.rejects(
    () => uploadVideoBytes('https://upload.example/session-123', {}, 1, 'video/mp4', mockFetch),
    /YouTube video upload failed: 500/
  );
});

test('setThumbnail posts the PNG bytes with the right content type and videoId query param', async () => {
  const pngBytes = new Uint8Array([1, 2, 3]);
  let seenUrl, seenInit;
  const mockFetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return { ok: true };
  };

  await setThumbnail('access-token', 'yt-video-id-123', pngBytes, mockFetch);
  assert.ok(seenUrl.includes('videoId=yt-video-id-123'));
  assert.equal(seenInit.headers.authorization, 'Bearer access-token');
  assert.equal(seenInit.headers['content-type'], 'image/png');
  assert.strictEqual(seenInit.body, pngBytes);
});

test('setThumbnail throws a readable error on a failed request', async () => {
  const mockFetch = async () => ({ ok: false, status: 400, text: async () => 'bad thumbnail' });
  await assert.rejects(
    () => setThumbnail('tok', 'vid', new Uint8Array([1]), mockFetch),
    /Failed to set YouTube thumbnail: 400/
  );
});
