const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractAudio, cutAndCropClip, streamToBytes } = require('./media-transform.js');

function fakeStream(chunks) {
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i < chunks.length) return { done: false, value: chunks[i++] };
          return { done: true, value: undefined };
        },
      };
    },
  };
}

test('streamToBytes concatenates chunks in order', async () => {
  const stream = fakeStream([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]);
  const bytes = await streamToBytes(stream);
  assert.deepEqual(Array.from(bytes), [1, 2, 3, 4, 5]);
});

test('cutAndCropClip rejects a duration outside the 1-60s Media Transformations range before touching R2 or the transform binding', async () => {
  const env = {}; // deliberately no MEDIA/MEDIA_TRANSFORM — must never be reached
  await assert.rejects(
    () => cutAndCropClip(env, 'videos/x/talk.mp4', { startSeconds: 0, durationSeconds: 0 }),
    /outside Media Transformations' 1-60s range/
  );
  await assert.rejects(
    () => cutAndCropClip(env, 'videos/x/talk.mp4', { startSeconds: 0, durationSeconds: 61 }),
    /outside Media Transformations' 1-60s range/
  );
});

test('extractAudio throws a readable error when the source R2 object is missing', async () => {
  const env = { MEDIA: { get: async () => null } };
  await assert.rejects(
    () => extractAudio(env, 'videos/x/talk.mp4'),
    /No R2 object at "videos\/x\/talk\.mp4"/
  );
});

test('cutAndCropClip throws a readable error when the source R2 object is missing', async () => {
  const env = { MEDIA: { get: async () => null } };
  await assert.rejects(
    () => cutAndCropClip(env, 'videos/x/talk.mp4', { startSeconds: 0, durationSeconds: 30 }),
    /No R2 object at "videos\/x\/talk\.mp4"/
  );
});

test('cutAndCropClip calls the transform binding with cover-fit vertical dimensions and the clamped time window', async () => {
  const calls = { transform: null, output: null };
  const env = {
    MEDIA: { get: async () => ({ body: 'fake-stream' }) },
    MEDIA_TRANSFORM: {
      input(body) {
        assert.equal(body, 'fake-stream');
        return {
          transform(opts) {
            calls.transform = opts;
            return {
              output(opts2) {
                calls.output = opts2;
                return { media: async () => fakeStream([new Uint8Array([9])]) };
              },
            };
          },
        };
      },
    },
  };

  const bytes = await cutAndCropClip(env, 'videos/x/talk.mp4', { startSeconds: 12, durationSeconds: 30 });
  assert.deepEqual(Array.from(bytes), [9]);
  assert.deepEqual(calls.transform, { width: 1080, height: 1920, fit: 'cover' });
  assert.deepEqual(calls.output, { time: '12s', duration: '30s' });
});

test('extractAudio calls the transform binding in audio-only mode', async () => {
  let seenOutput;
  const env = {
    MEDIA: { get: async () => ({ body: 'fake-stream' }) },
    MEDIA_TRANSFORM: {
      input: () => ({
        output(opts) {
          seenOutput = opts;
          return { media: async () => fakeStream([new Uint8Array([7])]) };
        },
      }),
    },
  };

  const bytes = await extractAudio(env, 'videos/x/talk.mp4');
  assert.deepEqual(Array.from(bytes), [7]);
  assert.deepEqual(seenOutput, { mode: 'audio' });
});
