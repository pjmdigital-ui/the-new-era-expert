const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMetadataPrompt, callClaude, generateValidatedOptions } = require('./metadata-agent.js');

test('buildMetadataPrompt includes the subject and no feedback block when none given', () => {
  const prompt = buildMetadataPrompt({ topicTitle: 'What is a knowledge-based tool hub?' });
  assert.ok(prompt.includes('What is a knowledge-based tool hub?'));
  assert.ok(!prompt.includes('previous attempt'));
});

test('buildMetadataPrompt falls back to filename, then a generic subject', () => {
  const withFilename = buildMetadataPrompt({ filename: 'talk.mp4' });
  assert.ok(withFilename.includes('talk.mp4'));

  const withNeither = buildMetadataPrompt({});
  assert.ok(withNeither.includes('this video'));
});

test('buildMetadataPrompt appends feedback issues when provided', () => {
  const prompt = buildMetadataPrompt({ topicTitle: 'X' }, ['Title is 12 chars — target is 40-70.']);
  assert.ok(prompt.includes('previous attempt'));
  assert.ok(prompt.includes('Title is 12 chars'));
});

test('buildMetadataPrompt encodes the elite-strategist framework, the structured description sections, and mytoolhub.ai', () => {
  const prompt = buildMetadataPrompt({ topicTitle: 'X' });
  assert.ok(prompt.includes('elite YouTube growth strategist'));
  assert.ok(prompt.includes('mytoolhub.ai'));
  assert.ok(prompt.includes('Value preview'));
  assert.ok(prompt.includes('Resource line'));
  assert.ok(prompt.includes('Keyword paragraph'));
});

test('buildMetadataPrompt bans the AI-tell phrasing and fabricated-statistic patterns', () => {
  const prompt = buildMetadataPrompt({ topicTitle: 'X' });
  assert.ok(prompt.includes('it\'s not X, it\'s Y'));
  assert.ok(prompt.includes('"quiet" or "quietly"'));
  assert.ok(prompt.includes('never invent numbers'));
});

function fakeClaudeResponse(body, { ok = true, status = 200 } = {}) {
  return async () => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

test('callClaude parses the structured JSON from the response text block', async () => {
  const payload = {
    titleOptions: ['A reasonably long and compliant sample video title here'],
    descriptionOptions: ['A description.'],
    thumbnailTextOptions: ['STOP THIS NOW'],
  };
  const mockFetch = fakeClaudeResponse({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });

  const result = await callClaude('generate stuff', 'fake-key', mockFetch);
  assert.deepEqual(result, payload);
});

test('callClaude throws a readable error on a non-ok HTTP response', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'server exploded',
  });
  await assert.rejects(
    () => callClaude('generate stuff', 'fake-key', mockFetch),
    /Claude API call failed: 500/
  );
});

test('callClaude throws when Claude refuses the request', async () => {
  const mockFetch = fakeClaudeResponse({ stop_reason: 'refusal', content: [] });
  await assert.rejects(
    () => callClaude('generate stuff', 'fake-key', mockFetch),
    /declined/
  );
});

test('generateValidatedOptions returns immediately when the first attempt already passes validation', async () => {
  const payload = {
    titleOptions: [
      'A reasonably long and compliant sample video title here today',
      'Another reasonably long and compliant sample title for testing',
    ],
    descriptionOptions: ['A description.'],
    thumbnailTextOptions: ['STOP THIS NOW'],
  };
  let calls = 0;
  const mockFetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
    };
  };

  const result = await generateValidatedOptions({ topicTitle: 'X' }, 'fake-key', { fetchFn: mockFetch });
  assert.equal(calls, 1);
  assert.equal(result.validation.attempts, 1);
  assert.deepEqual(result.validation.warnings, []);
  assert.deepEqual(result.titleOptions, payload.titleOptions);
});

test('generateValidatedOptions retries with feedback and succeeds on a later attempt', async () => {
  const badPayload = {
    titleOptions: ['TOO SHORT'],
    descriptionOptions: ['A description.'],
    thumbnailTextOptions: ['NOPE'],
  };
  const goodPayload = {
    titleOptions: [
      'A reasonably long and compliant sample video title here today',
      'Another reasonably long and compliant sample title for testing',
    ],
    descriptionOptions: ['A description.'],
    thumbnailTextOptions: ['STOP THIS NOW'],
  };

  let calls = 0;
  const seenPrompts = [];
  const mockFetch = async (url, init) => {
    calls++;
    seenPrompts.push(JSON.parse(init.body).messages[0].content);
    const payload = calls === 1 ? badPayload : goodPayload;
    return {
      ok: true,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
    };
  };

  const result = await generateValidatedOptions({ topicTitle: 'X' }, 'fake-key', { fetchFn: mockFetch, maxAttempts: 3 });
  assert.equal(calls, 2);
  assert.equal(result.validation.attempts, 2);
  assert.ok(seenPrompts[1].includes('previous attempt'), 'second prompt should include corrective feedback');
});

test('generateValidatedOptions never hard-fails — returns the last attempt with warnings after maxAttempts', async () => {
  const badPayload = {
    titleOptions: ['TOO SHORT'],
    descriptionOptions: ['A description.'],
    thumbnailTextOptions: ['NOPE'],
  };
  let calls = 0;
  const mockFetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(badPayload) }] }),
    };
  };

  const result = await generateValidatedOptions({ topicTitle: 'X' }, 'fake-key', { fetchFn: mockFetch, maxAttempts: 3 });
  assert.equal(calls, 3);
  assert.equal(result.validation.attempts, 3);
  assert.ok(result.validation.warnings.length > 0);
  assert.deepEqual(result.titleOptions, badPayload.titleOptions);
});
