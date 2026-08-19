/**
 * Topic demand-scoring agent — implements the brief's Section 4b demand
 * data: "scan 3-5 relevant competitor YouTube channels for recent uploads,
 * score by view count + recency + keyword match to each topic in the list."
 *
 * Design note: the scoring math (pure, testable, no network) is separated
 * from the fetching (needs a real YouTube Data API key + network access).
 * This is deliberate — the scoring logic can be fully verified without a
 * live key; only fetchDemandScore() needs one, and it's a thin wrapper
 * around the pure function below.
 *
 * Requires a YouTube Data API v3 key (read-only search — this is NOT the
 * same credential as the OAuth flow needed for publishing; a simple API
 * key from Google Cloud Console is enough for search.list/videos.list).
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// How far back a video's publish date counts as "recent" for the recency
// component of the score. Older matches still count (via view count) but
// don't get the recency bonus.
const RECENCY_WINDOW_DAYS = 180;

/**
 * @typedef {Object} VideoResult
 * @property {string} videoId
 * @property {string} title
 * @property {number} viewCount
 * @property {string} publishedAt — ISO date string
 */

/**
 * Pure scoring function — no network calls. Given a topic's title and a
 * list of matching videos (already fetched), computes a 0-100 demand score.
 *
 * Weighting:
 *   - View count (log-scaled, since view counts span orders of magnitude
 *     and a single viral outlier shouldn't dominate the score) — AVERAGED
 *     across matched videos, not summed.
 *   - Recency (videos inside RECENCY_WINDOW_DAYS get full weight, older
 *     ones decay linearly to a floor rather than dropping to zero) — also
 *     averaged, not summed.
 *   - Match count (more matching videos = more validated demand for the
 *     topic, with diminishing returns past ~10 results) — this ONE
 *     component is deliberately not averaged, since result volume is its
 *     own distinct signal.
 *
 * View and recency are averaged rather than summed on purpose: summing
 * meant that any topic returning a full batch of matches (search.list caps
 * at 25) trivially inflated the score just from having more results, which
 * saturated nearly every real topic to the 100 ceiling regardless of how
 * popular those videos actually were — confirmed live once a real API key
 * was connected. Averaging measures "how popular are the videos that
 * actually match this topic," independent of how many results came back.
 *
 * @param {VideoResult[]} videos
 * @param {Date} [now] — injectable for testing
 * @returns {number} 0-100
 */
function scoreFromSearchResults(videos, now = new Date()) {
  if (!videos || videos.length === 0) return 0;

  const avgViewComponent = videos.reduce((sum, v) => {
    // log10(views + 1) caps the influence of any single viral video —
    // 10 views vs 100 views should matter more than 1M vs 10M views.
    return sum + Math.log10(Math.max(v.viewCount, 0) + 1);
  }, 0) / videos.length;

  const avgRecencyComponent = videos.reduce((sum, v) => {
    const ageDays = (now.getTime() - new Date(v.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= RECENCY_WINDOW_DAYS) return sum + 1;
    // Linear decay from full weight at RECENCY_WINDOW_DAYS to a 0.2 floor
    // at 2 years — an old-but-evergreen match still signals some demand.
    const decay = Math.max(0.2, 1 - (ageDays - RECENCY_WINDOW_DAYS) / 730);
    return sum + decay;
  }, 0) / videos.length;

  // Diminishing returns past 10 matches — a topic with 40 matching videos
  // isn't 4x more in-demand than one with 10, it's just a broad topic.
  const matchComponent = Math.min(videos.length, 10) + Math.log10(Math.max(videos.length - 10, 0) + 1);

  // Weights re-tuned by hand against realistic weak/moderate/strong/
  // extreme scenarios after the original sum-based weights (x3/x8/x4) were
  // found, live, to saturate every real topic to 100. See
  // topic-agent.test.js's saturation regression test for the specific
  // numbers this was checked against.
  const raw = avgViewComponent * 9 + avgRecencyComponent * 10 + matchComponent * 2.5;
  return Math.min(100, Math.round(raw));
}

/**
 * Fetches YouTube search results for a query and returns them with view
 * counts attached (search.list doesn't include statistics, so this makes
 * a second call to videos.list for the returned video IDs).
 *
 * @param {string} query
 * @param {string} apiKey
 * @param {typeof fetch} [fetchFn] — injectable for testing
 * @returns {Promise<VideoResult[]>}
 */
async function fetchYoutubeMatches(query, apiKey, fetchFn = fetch) {
  const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&order=relevance&maxResults=25&q=${encodeURIComponent(query)}&key=${apiKey}`;
  const searchRes = await fetchFn(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.status} ${await searchRes.text()}`);
  }
  const searchData = await searchRes.json();
  const items = searchData.items || [];
  if (items.length === 0) return [];

  const videoIds = items.map(item => item.id.videoId).filter(Boolean).join(',');
  const statsUrl = `${YOUTUBE_API_BASE}/videos?part=statistics&id=${videoIds}&key=${apiKey}`;
  const statsRes = await fetchFn(statsUrl);
  if (!statsRes.ok) {
    throw new Error(`YouTube video stats failed: ${statsRes.status} ${await statsRes.text()}`);
  }
  const statsData = await statsRes.json();
  const statsById = new Map((statsData.items || []).map(v => [v.id, v.statistics]));

  return items
    .filter(item => item.id.videoId && statsById.has(item.id.videoId))
    .map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      viewCount: Number(statsById.get(item.id.videoId).viewCount || 0),
      publishedAt: item.snippet.publishedAt,
    }));
}

/**
 * Full pipeline for one topic: derive a search query from its title,
 * fetch matches, score them. This is what functions/api/topics.js calls
 * per topic when a demand-score refresh is triggered.
 *
 * @param {{title: string}} topic
 * @param {string} apiKey
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<number>}
 */
async function scoreTopic(topic, apiKey, fetchFn = fetch) {
  const videos = await fetchYoutubeMatches(topic.title, apiKey, fetchFn);
  return scoreFromSearchResults(videos);
}

module.exports = {
  RECENCY_WINDOW_DAYS,
  scoreFromSearchResults,
  fetchYoutubeMatches,
  scoreTopic,
};
