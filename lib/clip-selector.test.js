const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampDuration, buildClipSelectionPrompt, selectClipCandidates } = require('./clip-selector.js');
const { MIN_CLIP_DURATION_SECONDS, MAX_CLIP_DURATION_SECONDS } = require('./media-transform.js');

test('clampDuration keeps an in-range segment unchanged (aside from computing durationSeconds)', () => {
  const clamped = clampDuration({ startSeconds: 10, endSeconds: 40, reason: 'x' });
  assert.equal(clamped.startSeconds, 10);
  assert.equal(clamped.durationSeconds, 30);
  assert.equal(clamped.reason, 'x');
});

test('clampDuration clamps a too-long segment down to the max', () => {
  const clamped = clampDuration({ startSeconds: 0, endSeconds: 500 });
  assert.equal(clamped.durationSeconds, MAX_CLIP_DURATION_SECONDS);
});

test('clampDuration clamps a zero/negative-length segment up to the min', () => {
  const zero = clampDuration({ startSeconds: 10, endSeconds: 10 });
  assert.equal(zero.durationSeconds, MIN_CLIP_DURATION_SECONDS);

  const negative = clampDuration({ startSeconds: 10, endSeconds: 5 });
  assert.equal(negative.durationSeconds, MIN_CLIP_DURATION_SECONDS);
});

test('clampDuration never lets startSeconds go negative', () => {
  const clamped = clampDuration({ startSeconds: -5, endSeconds: 10 });
  assert.equal(clamped.startSeconds, 0);
});

test('clampDuration handles non-numeric input without throwing', () => {
  const clamped = clampDuration({ startSeconds: 'x', endSeconds: 'y' });
  assert.equal(clamped.durationSeconds, MIN_CLIP_DURATION_SECONDS);
  assert.equal(clamped.startSeconds, 0);
});

test('buildClipSelectionPrompt includes the transcript and the requested count', () => {
  const prompt = buildClipSelectionPrompt('00:00 hello world', 5);
  assert.ok(prompt.includes('00:00 hello world'));
  assert.ok(prompt.includes('Select 5'));
});

test('selectClipCandidates parses and clamps every returned clip', async () => {
  const payload = {
    clips: [
      {
        startSeconds: 5,
        endSeconds: 35,
        reason: 'strong hook',
        transcriptExcerpt: 'excerpt one',
        captions: { tiktok: 't1', instagram: 'i1', linkedin: 'l1' },
      },
      {
        startSeconds: 100,
        endSeconds: 900, // way over 60s — must be clamped
        reason: 'too long',
        transcriptExcerpt: 'excerpt two',
        captions: { tiktok: 't2', instagram: 'i2', linkedin: 'l2' },
      },
    ],
  };
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  });

  const clips = await selectClipCandidates('a transcript', 'fake-key', { count: 2 }, mockFetch);
  assert.equal(clips.length, 2);
  assert.equal(clips[0].durationSeconds, 30);
  assert.equal(clips[1].durationSeconds, MAX_CLIP_DURATION_SECONDS);
  assert.equal(clips[0].captions.tiktok, 't1');
});

test('selectClipCandidates throws when Claude refuses', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ stop_reason: 'refusal', content: [] }),
  });
  await assert.rejects(
    () => selectClipCandidates('a transcript', 'fake-key', {}, mockFetch),
    /declined/
  );
});
