/**
 * Topic ranking — single source of truth for "what gets made next."
 *
 * Both the dashboard's "what's coming up" preview AND the automated topic
 * picker must call rankTopics() against the SAME underlying topic list
 * (read from CONTENT_KV, never a second copy in a committed file or a
 * different KV key). Two independent data sources drifting apart caused
 * real confusion on the reference project — the preview showed one answer,
 * the automation did something else.
 *
 * Sort order (this exact order, not "sort by demand with a coverage
 * tie-break" — that was the shipped bug: demand scores are basically never
 * exactly tied, so a tie-break by recency never actually fires, and the
 * same 3 highest-scoring topics get picked forever while the rest of the
 * list never gets a turn):
 *
 *   1. Primary   — fewest times covered, ascending. Guarantees every topic
 *                  in the list gets made before any topic repeats.
 *   2. Secondary — among topics tied on coverage count, highest demand
 *                  score first.
 *   3. Tertiary  — among topics tied on both, oldest last-covered date
 *                  first (a topic never covered sorts before one covered
 *                  long ago, which sorts before one covered recently).
 */

/**
 * @typedef {Object} Topic
 * @property {string} id
 * @property {string} title
 * @property {string} entryPoint  // which of the 6 belief-territories this leads with
 * @property {number} timesCovered
 * @property {number} demandScore // from competitor-channel scan; higher = more demand
 * @property {string|null} lastCoveredAt // ISO date string, or null if never covered
 */

/**
 * Returns topics sorted by the coverage-gated rotation rule above.
 * Pure function — does not mutate the input array.
 * @param {Topic[]} topics
 * @returns {Topic[]}
 */
function rankTopics(topics) {
  return [...topics].sort((a, b) => {
    // 1. Fewest times covered first — this is the rule that guarantees
    //    rotation. Never let this be anything but the primary sort key.
    if (a.timesCovered !== b.timesCovered) {
      return a.timesCovered - b.timesCovered;
    }

    // 2. Among equally-covered topics, highest demand score first.
    if (a.demandScore !== b.demandScore) {
      return b.demandScore - a.demandScore;
    }

    // 3. Among topics tied on both, oldest last-covered first. Never-covered
    //    (null) sorts before any real date.
    const aTime = a.lastCoveredAt ? new Date(a.lastCoveredAt).getTime() : -Infinity;
    const bTime = b.lastCoveredAt ? new Date(b.lastCoveredAt).getTime() : -Infinity;
    return aTime - bTime;
  });
}

/**
 * Convenience wrapper — the single next topic to make.
 * @param {Topic[]} topics
 * @returns {Topic|undefined}
 */
function nextTopic(topics) {
  return rankTopics(topics)[0];
}

module.exports = { rankTopics, nextTopic };
