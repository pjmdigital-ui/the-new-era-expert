/**
 * OAuth token exchange for the YouTube publish flow — a refresh_token grant
 * against Google's token endpoint. Distinct credential from
 * YOUTUBE_DATA_API_KEY (the simple read-only API key lib/topic-agent.js
 * uses for demand scoring): this one is the OAuth client needed to upload
 * on behalf of the channel.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * @param {{YOUTUBE_CLIENT_ID: string, YOUTUBE_CLIENT_SECRET: string, YOUTUBE_REFRESH_TOKEN: string}} env
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>} a short-lived access token
 */
async function getAccessToken(env, fetchFn = fetch) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: env.YOUTUBE_REFRESH_TOKEN,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`YouTube OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('YouTube OAuth token response had no access_token');
  }
  return data.access_token;
}

module.exports = { getAccessToken };
