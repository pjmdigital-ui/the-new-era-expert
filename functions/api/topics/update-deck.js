const { getTopics, saveTopics } = require('../../../lib/topics-store.js');
const { pickSizeBand } = require('../../../lib/slide-deck.js');
const seedData = require('../../../data/seed-topics.json');

// Saves hand-edited slide text (or a slide deletion) back onto a topic's
// cached slideDeck, without going through Claude at all -- this is for
// small in-place fixes (cut a line, tighten a sentence, drop a slide)
// where a full Regenerate would throw away everything else in the deck.
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const { id, slides } = body;

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }
  if (!Array.isArray(slides) || slides.length === 0) {
    return Response.json({ error: 'slides must be a non-empty array' }, { status: 400 });
  }
  for (const slide of slides) {
    if (typeof slide.headline !== 'string' || !slide.headline.trim() || typeof slide.body !== 'string' || !slide.body.trim()) {
      return Response.json({ error: 'each slide needs a non-empty headline and body' }, { status: 400 });
    }
  }

  const topics = await getTopics(env, seedData);
  const topic = topics.find(t => t.id === id);
  if (!topic) {
    return Response.json({ error: `No topic with id "${id}"` }, { status: 404 });
  }
  if (!topic.slideDeck) {
    return Response.json({ error: 'This topic has no slide deck to edit yet' }, { status: 400 });
  }

  const editedSlides = slides.map(slide => {
    const trimmedBody = slide.body.trim();
    return {
      headline: slide.headline.trim(),
      body: trimmedBody,
      size: pickSizeBand(trimmedBody),
    };
  });

  const updated = topics.map(t =>
    t.id === id
      ? { ...t, slideDeck: { ...t.slideDeck, slides: editedSlides, editedAt: new Date().toISOString() } }
      : t
  );
  await saveTopics(env, updated);

  return Response.json(updated.find(t => t.id === id));
}
