const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankTopics, nextTopic } = require('./topic-ranker.js');

test('coverage count beats demand score — the exact bug this must never regress into', () => {
  // 3 topics with much higher demand than the other 12, all uncovered.
  // If sort order were ever "demand first, coverage as tie-break," these
  // 3 would keep winning forever since their scores are never exactly tied
  // with each other or anything else.
  const topics = [
    { id: 'hot-1', title: 'High demand 1', timesCovered: 0, demandScore: 98, lastCoveredAt: null },
    { id: 'hot-2', title: 'High demand 2', timesCovered: 0, demandScore: 95, lastCoveredAt: null },
    { id: 'hot-3', title: 'High demand 3', timesCovered: 0, demandScore: 91, lastCoveredAt: null },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `cold-${i}`,
      title: `Low demand ${i}`,
      timesCovered: 0,
      demandScore: 10 + i, // low, never tied with the hot ones or each other
      lastCoveredAt: null,
    })),
  ];

  // Simulate picking one topic at a time and "covering" it, 15 times —
  // every single topic must be picked exactly once before any repeats.
  const picked = [];
  let pool = topics;
  for (let i = 0; i < 15; i++) {
    const chosen = nextTopic(pool);
    picked.push(chosen.id);
    pool = pool.map(t =>
      t.id === chosen.id
        ? { ...t, timesCovered: t.timesCovered + 1, lastCoveredAt: new Date(2026, 0, i + 1).toISOString() }
        : t
    );
  }

  assert.equal(new Set(picked).size, 15, 'all 15 topics must be picked before any repeat');
});

test('among equally-covered topics, higher demand score wins', () => {
  const topics = [
    { id: 'a', title: 'A', timesCovered: 1, demandScore: 50, lastCoveredAt: '2026-07-01' },
    { id: 'b', title: 'B', timesCovered: 1, demandScore: 80, lastCoveredAt: '2026-07-01' },
  ];
  assert.equal(nextTopic(topics).id, 'b');
});

test('among topics tied on coverage and demand, oldest last-covered wins', () => {
  const topics = [
    { id: 'a', title: 'A', timesCovered: 2, demandScore: 50, lastCoveredAt: '2026-07-15' },
    { id: 'b', title: 'B', timesCovered: 2, demandScore: 50, lastCoveredAt: '2026-06-01' },
  ];
  assert.equal(nextTopic(topics).id, 'b');
});

test('never-covered (null lastCoveredAt) sorts before any real date at the same coverage/demand tier', () => {
  const topics = [
    { id: 'a', title: 'A', timesCovered: 0, demandScore: 50, lastCoveredAt: '2020-01-01' },
    { id: 'b', title: 'B', timesCovered: 0, demandScore: 50, lastCoveredAt: null },
  ];
  assert.equal(nextTopic(topics).id, 'b');
});

test('rankTopics does not mutate its input', () => {
  const topics = [
    { id: 'a', title: 'A', timesCovered: 1, demandScore: 50, lastCoveredAt: null },
    { id: 'b', title: 'B', timesCovered: 0, demandScore: 10, lastCoveredAt: null },
  ];
  const original = JSON.stringify(topics);
  rankTopics(topics);
  assert.equal(JSON.stringify(topics), original);
});
