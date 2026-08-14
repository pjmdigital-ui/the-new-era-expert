const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ENTRY_POINTS,
  fetchSearchSuggestions,
  buildDiscoveryPrompt,
  synthesizeCandidateTopics,
} = require('./topic-discovery.js');

test('fetchSearchSuggestions parses the suggest endpoint\'s [query, suggestions[], ...] shape', async () => {
  const mockFetch = async (url) => {
    assert.ok(url.includes('client=firefox'));
    assert.ok(url.includes('q=knowledge%20hub'));
    return {
      ok: true,
      json: async () => ['knowledge hub', ['knowledge hub software', 'knowledge base tool'], [], {}],
    };
  };
  const suggestions = await fetchSearchSuggestions('knowledge hub', mockFetch);
  assert.deepEqual(suggestions, ['knowledge hub software', 'knowledge base tool']);
});

test('fetchSearchSuggestions throws a readable error on a failed request', async () => {
  const mockFetch = async () => ({ ok: false, status: 503, text: async () => 'unavailable' });
  await assert.rejects(
    () => fetchSearchSuggestions('anything', mockFetch),
    /YouTube suggest endpoint failed: 503/
  );
});

test('fetchSearchSuggestions throws on an unexpected response shape rather than silently returning garbage', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ unexpected: 'shape' }) });
  await assert.rejects(
    () => fetchSearchSuggestions('anything', mockFetch),
    /unexpected shape/
  );
});

test('buildDiscoveryPrompt includes the signal items, existing titles (as a do-not-repeat list), and the requested count', () => {
  const prompt = buildDiscoveryPrompt(
    'YouTube search suggestions',
    ['ai course creator tools', 'knowledge base for coaches'],
    ['Why courses are dying', 'The knowledge hub category explained'],
    5
  );
  assert.ok(prompt.includes('ai course creator tools'));
  assert.ok(prompt.includes('knowledge base for coaches'));
  assert.ok(prompt.includes('Why courses are dying'));
  assert.ok(prompt.includes('do NOT repeat'));
  assert.ok(prompt.includes('5 new, distinct'));
});

test('synthesizeCandidateTopics returns the parsed candidates array from a mock Claude response', async () => {
  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'claude-opus-5');
    assert.equal(body.output_config.format.type, 'json_schema');
    return {
      ok: true,
      json: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            candidates: [
              { title: 'The knowledge hub category, explained in 90 seconds', entryPoint: 'category-exists', rationale: 'Surfaced from autocomplete signal for "knowledge hub"' },
            ],
          }),
        }],
      }),
    };
  };
  const candidates = await synthesizeCandidateTopics(
    { description: 'YouTube search suggestions', items: ['knowledge hub explained'] },
    ['Some existing title'],
    'fake-key',
    { count: 3 },
    mockFetch
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].entryPoint, 'category-exists');
  assert.ok(ENTRY_POINTS.includes(candidates[0].entryPoint));
});

test('synthesizeCandidateTopics throws a readable error on a failed Claude request', async () => {
  const mockFetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
  await assert.rejects(
    () => synthesizeCandidateTopics({ description: 'x', items: [] }, [], 'fake-key', {}, mockFetch),
    /Claude topic-discovery call failed: 500/
  );
});

test('synthesizeCandidateTopics throws when Claude refuses rather than returning an empty result silently', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(
    () => synthesizeCandidateTopics({ description: 'x', items: [] }, [], 'fake-key', {}, mockFetch),
    /declined to propose topics/
  );
});
