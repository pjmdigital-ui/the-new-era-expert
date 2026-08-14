// On-camera slide deck presenter view. Loaded via ?id=<topicId>. Fetches
// the topic (GET /api/topics/<id>); if it has no cached slideDeck yet,
// generates one (POST /api/topics/generate-deck) and renders the response
// directly — same "render from the mutating route's full response" pattern
// used throughout this dashboard.

const els = {
  statusScreen: document.getElementById('status-screen'),
  statusMessage: document.getElementById('status-message'),
  stage: document.getElementById('stage'),
  footerBar: document.getElementById('footer-bar'),
  footerTitle: document.getElementById('footer-title'),
  footerCount: document.getElementById('footer-count'),
  counter: document.getElementById('counter'),
  regenerateBtn: document.getElementById('regenerate-btn'),
};

let slideCount = 0;
let current = 0;

function getTopicIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showStatus(message) {
  els.statusMessage.innerHTML = escapeHtml(message);
  els.statusScreen.style.display = 'flex';
  els.stage.style.display = 'none';
  els.footerBar.style.display = 'none';
}

function showError(message) {
  els.statusMessage.innerHTML = `${escapeHtml(message)}<br><br><a href="index.html">&larr; Back to topics</a>`;
  els.statusScreen.style.display = 'flex';
  els.stage.style.display = 'none';
  els.footerBar.style.display = 'none';
}

function renderDeck(topic) {
  const slides = (topic.slideDeck && topic.slideDeck.slides) || [];
  if (slides.length === 0) {
    showError('This deck has no slides.');
    return;
  }

  els.statusScreen.style.display = 'none';
  els.stage.style.display = 'block';
  els.footerBar.style.display = 'flex';
  els.footerTitle.textContent = topic.title;
  els.footerCount.textContent = `${slides.length} slides`;

  els.stage.innerHTML = slides.map((slide, i) => `
    <section class="slide size-${escapeHtml(slide.size || 'md')}${i === 0 ? ' active' : ''}" data-index="${i}">
      <div class="text-pane">
        <div class="gold-line"></div>
        <div class="headline">${escapeHtml(slide.headline)}</div>
        <div class="body">${escapeHtml(slide.body)}</div>
        ${slide.guidance ? `<div class="guidance">${escapeHtml(slide.guidance)}</div>` : ''}
      </div>
    </section>
  `).join('');

  slideCount = slides.length;
  show(0);
}

function show(index) {
  const sections = els.stage.querySelectorAll('section.slide');
  sections.forEach((s, i) => s.classList.toggle('active', i === index));
  current = index;
  els.counter.textContent = slideCount ? `${current + 1} / ${slideCount}` : '';
}

function next() {
  if (slideCount === 0) return;
  show(Math.min(slideCount - 1, current + 1));
}

function prev() {
  if (slideCount === 0) return;
  show(Math.max(0, current - 1));
}

async function loadDeck(id, { forceRegenerate = false } = {}) {
  showStatus('Loading…');
  try {
    let topic;
    if (!forceRegenerate) {
      const res = await fetch(`/api/topics/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to load topic: ${res.status}`);
      topic = data;
    }

    if (forceRegenerate || !topic.slideDeck) {
      showStatus('Generating your script…');
      const res = await fetch('/api/topics/generate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, regenerate: forceRegenerate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to generate deck: ${res.status}`);
      topic = data;
    }

    renderDeck(topic);
  } catch (err) {
    showError(err.message);
  } finally {
    els.regenerateBtn.disabled = false;
    els.regenerateBtn.textContent = 'Regenerate';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    prev();
  } else if (e.key === 'Home') {
    show(0);
  } else if (e.key === 'End') {
    if (slideCount) show(slideCount - 1);
  }
});

els.stage.addEventListener('click', () => next());

els.regenerateBtn.addEventListener('click', () => {
  const id = getTopicIdFromUrl();
  if (!id) return;
  els.regenerateBtn.disabled = true;
  els.regenerateBtn.textContent = 'Regenerating…';
  loadDeck(id, { forceRegenerate: true });
});

const topicId = getTopicIdFromUrl();
if (!topicId) {
  showError('No topic id provided.');
} else {
  loadDeck(topicId);
}
