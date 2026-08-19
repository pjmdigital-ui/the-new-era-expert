const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreFromSearchResults, fetchYoutubeMatches, scoreTopic } = require('./topic-agent.js');

test('scoreFromSearchResults returns 0 for no matches', () => {
  assert.equal(scoreFromSearchResults([]), 0);
  assert.equal(scoreFromSearchResults(null), 0);
});

test('scoreFromSearchResults scores more/recent/higher-viewed matches higher', () => {
  const now = new Date('2026-08-01T00:00:00Z');

  const weak = scoreFromSearchResults([
    { videoId: 'a', title: 'A', viewCount: 50, publishedAt: '2020-01-01T00:00:00Z' },
  ], now);

  const strong = scoreFromSearchResults([
    { videoId: 'a', title: 'A', viewCount: 500000, publishedAt: '2026-07-01T00:00:00Z' },
    { videoId: 'b', title: 'B', viewCount: 300000, publishedAt: '2026-06-15T00:00:00Z' },
    { videoId: 'c', title: 'C', viewCount: 150000, publishedAt: '2026-05-01T00:00:00Z' },
  ], now);

  assert.ok(strong > weak, `expected strong (${strong}) > weak (${weak})`);
});

test('scoreFromSearchResults never exceeds 100', () => {
  const now = new Date('2026-08-01T00:00:00Z');
  const massiveResults = Array.from({ length: 25 }, (_, i) => ({
    videoId: `v${i}`,
    title: `Video ${i}`,
    viewCount: 50_000_000,
    publishedAt: '2026-07-30T00:00:00Z',
  }));
  const score = scoreFromSearchResults(massiveResults, now);
  assert.ok(score <= 100, `score ${score} exceeded 100`);
});

test('scoreFromSearchResults does not saturate to 100 for a realistic moderate-demand batch (regression: the original weights SUMMED each video\'s view/recency contribution instead of averaging, so any full 25-result batch inflated the score to 100 purely from result COUNT, regardless of how popular those videos actually were -- confirmed live once a real API key was connected, every topic scored exactly 100)', () => {
  const now = new Date('2026-08-01T00:00:00Z');
  const moderateResults = Array.from({ length: 25 }, (_, i) => ({
    videoId: `v${i}`,
    title: `Video ${i}`,
    viewCount: 5000, // modest, realistic view count -- not viral
    publishedAt: '2025-08-01T00:00:00Z', // a year old, past the recency window
  }));
  const score = scoreFromSearchResults(moderateResults, now);
  assert.ok(
    score > 30 && score < 90,
    `score ${score} should land in a differentiated middle range for moderate demand, not saturate near 100 or bottom out near 0`
  );
});

test('scoreFromSearchResults gives old videos a reduced but non-zero recency contribution', () => {
  const now = new Date('2026-08-01T00:00:00Z');
  const recent = scoreFromSearchResults([
    { videoId: 'a', title: 'A', viewCount: 10000, publishedAt: '2026-07-15T00:00:00Z' },
  ], now);
  const old = scoreFromSearchResults([
    { videoId: 'a', title: 'A', viewCount: 10000, publishedAt: '2022-01-01T00:00:00Z' },
  ], now);
  assert.ok(old > 0, 'old video should still contribute something, not zero out');
  assert.ok(recent > old, 'recent video should outscore an old one with identical views');
});

test('fetchYoutubeMatches calls search then videos.list and merges view counts', async () => {
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes('/search?')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: { videoId: 'vid1' }, snippet: { title: 'Match 1', publishedAt: '2026-07-01T00:00:00Z' } },
            { id: { videoId: 'vid2' }, snippet: { title: 'Match 2', publishedAt: '2026-06-01T00:00:00Z' } },
          ],
        }),
      };
    }
    if (url.includes('/videos?')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: 'vid1', statistics: { viewCount: '1000' } },
            { id: 'vid2', statistics: { viewCount: '2000' } },
          ],
        }),
      };
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  };

  const results = await fetchYoutubeMatches('why are my opt-in rates dropping', 'fake-key', mockFetch);

  assert.equal(calls.length, 2, 'should call search then videos.list');
  assert.equal(results.length, 2);
  assert.equal(results[0].viewCount, 1000);
  assert.equal(results[1].viewCount, 2000);
});

test('fetchYoutubeMatches returns empty array when search has no results (no wasted stats call)', async () => {
  let statsCallMade = false;
  const mockFetch = async (url) => {
    if (url.includes('/search?')) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    statsCallMade = true;
    return { ok: true, json: async () => ({ items: [] }) };
  };

  const results = await fetchYoutubeMatches('an extremely obscure query', 'fake-key', mockFetch);
  assert.deepEqual(results, []);
  assert.equal(statsCallMade, false, 'should not call videos.list when search returned nothing');
});

test('fetchYoutubeMatches throws with a readable error on a failed search request', async () => {
  const mockFetch = async () => ({ ok: false, status: 403, text: async () => 'quota exceeded' });
  await assert.rejects(
    () => fetchYoutubeMatches('anything', 'bad-key', mockFetch),
    /YouTube search failed: 403/
  );
});

test('scoreTopic runs the full pipeline end to end against a mock fetch', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/search?')) {
      return {
        ok: true,
        json: async () => ({
          items: [{ id: { videoId: 'v1' }, snippet: { title: 'X', publishedAt: '2026-07-01T00:00:00Z' } }],
        }),
      };
    }
    return { ok: true, json: async () => ({ items: [{ id: 'v1', statistics: { viewCount: '5000' } }] }) };
  };

  const score = await scoreTopic({ title: 'why are my opt-in rates dropping' }, 'fake-key', mockFetch);
  assert.ok(typeof score === 'number' && score > 0);
});
