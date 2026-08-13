const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getAccessToken } = require('./youtube-oauth.js');

const fakeEnv = {
  YOUTUBE_CLIENT_ID: 'client-id',
  YOUTUBE_CLIENT_SECRET: 'client-secret',
  YOUTUBE_REFRESH_TOKEN: 'refresh-token',
};

test('getAccessToken posts the refresh_token grant and returns the access token', async () => {
  let seenBody;
  const mockFetch = async (url, init) => {
    seenBody = init.body;
    return { ok: true, json: async () => ({ access_token: 'new-access-token' }) };
  };

  const token = await getAccessToken(fakeEnv, mockFetch);
  assert.equal(token, 'new-access-token');

  const params = new URLSearchParams(seenBody);
  assert.equal(params.get('grant_type'), 'refresh_token');
  assert.equal(params.get('client_id'), 'client-id');
  assert.equal(params.get('client_secret'), 'client-secret');
  assert.equal(params.get('refresh_token'), 'refresh-token');
});

test('getAccessToken throws a readable error on a failed exchange', async () => {
  const mockFetch = async () => ({ ok: false, status: 401, text: async () => 'invalid_grant' });
  await assert.rejects(
    () => getAccessToken(fakeEnv, mockFetch),
    /YouTube OAuth token exchange failed: 401/
  );
});

test('getAccessToken throws when the response has no access_token', async () => {
  const mockFetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(
    () => getAccessToken(fakeEnv, mockFetch),
    /no access_token/
  );
});
