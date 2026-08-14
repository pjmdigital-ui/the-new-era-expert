const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ENTRY_POINT_GOALS,
  buildSlideDeckPrompt,
  pickSizeBand,
  generateSlideDeck,
} = require('./slide-deck.js');

test('pickSizeBand picks lg for short bodies, md for typical length, sm for long explanatory paragraphs', () => {
  assert.equal(pickSizeBand('Here\'s the pattern.'), 'lg');
  assert.equal(pickSizeBand('x'.repeat(150)), 'lg');
  assert.equal(pickSizeBand('x'.repeat(151)), 'md');
  assert.equal(pickSizeBand('x'.repeat(400)), 'md');
  assert.equal(pickSizeBand('x'.repeat(401)), 'sm');
  assert.equal(pickSizeBand(''), 'lg');
});

test('buildSlideDeckPrompt includes the topic title, the entry-point belief goal, and the never-write-instructions requirement', () => {
  const prompt = buildSlideDeckPrompt({ title: 'Why Your Opt-In Rates Are Dropping', entryPoint: 'problem-is-real' });
  assert.ok(prompt.includes('Why Your Opt-In Rates Are Dropping'));
  assert.ok(prompt.includes(ENTRY_POINT_GOALS['problem-is-real']));
  assert.ok(prompt.includes('NOT a set of notes'));
  assert.ok(prompt.includes('MyToolHub'));
});

test('buildSlideDeckPrompt falls back gracefully for an unrecognized entryPoint', () => {
  const prompt = buildSlideDeckPrompt({ title: 'Some Topic', entryPoint: 'not-a-real-slug' });
  assert.ok(prompt.includes('advance the argument for this video'));
});

test('generateSlideDeck returns slides with a computed size band attached to a mock Claude response', async () => {
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
            slides: [
              { headline: 'Here\'s the trap.', body: 'Short hook body.' },
              { headline: 'The pattern', body: 'x'.repeat(500), guidance: 'pause here' },
            ],
          }),
        }],
      }),
    };
  };
  const slides = await generateSlideDeck({ title: 'Test Topic', entryPoint: 'act-now' }, 'fake-key', mockFetch);
  assert.equal(slides.length, 2);
  assert.equal(slides[0].size, 'lg');
  assert.equal(slides[1].size, 'sm');
  assert.equal(slides[1].guidance, 'pause here');
});

test('generateSlideDeck throws a readable error on a failed Claude request', async () => {
  const mockFetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
  await assert.rejects(
    () => generateSlideDeck({ title: 'x', entryPoint: 'act-now' }, 'fake-key', mockFetch),
    /Claude slide-deck call failed: 500/
  );
});

test('generateSlideDeck throws when Claude refuses rather than returning an empty deck silently', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(
    () => generateSlideDeck({ title: 'x', entryPoint: 'act-now' }, 'fake-key', mockFetch),
    /declined to generate a slide deck/
  );
});
