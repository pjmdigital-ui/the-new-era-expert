// On-camera slide deck presenter view. Loaded via ?id=<topicId>. Fetches
// the topic (GET /api/topics/<id>); if it has no cached slideDeck yet,
// generates one (POST /api/topics/generate-deck) and renders the response
// directly — same "render from the mutating route's full response" pattern
// used throughout this dashboard.
//
// Edit mode lets a slide's headline/body be edited or a slide deleted
// in-place (POST /api/topics/update-deck) without a full Regenerate, which
// would throw away everything including parts worth keeping. Keyboard
// navigation and click-to-advance are disabled while editing since arrow
// keys and space need to type normally inside the editable text.

const els = {
  statusScreen: document.getElementById('status-screen'),
  statusMessage: document.getElementById('status-message'),
  stage: document.getElementById('stage'),
  footerBar: document.getElementById('footer-bar'),
  footerTitle: document.getElementById('footer-title'),
  footerCount: document.getElementById('footer-count'),
  counter: document.getElementById('counter'),
  exitLink: document.getElementById('exit-link'),
  regenerateBtn: document.getElementById('regenerate-btn'),
  editBtn: document.getElementById('edit-btn'),
  prevSlideEditBtn: document.getElementById('prev-slide-edit-btn'),
  nextSlideEditBtn: document.getElementById('next-slide-edit-btn'),
  deleteSlideBtn: document.getElementById('delete-slide-btn'),
  saveEditBtn: document.getElementById('save-edit-btn'),
  cancelEditBtn: document.getElementById('cancel-edit-btn'),
};

let currentSlides = [];
let currentTopicId = null;
let slideCount = 0;
let current = 0;
let editing = false;
let editSnapshot = null;

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
  currentTopicId = topic.id;
  currentSlides = ((topic.slideDeck && topic.slideDeck.slides) || []).map(s => ({
    headline: s.headline,
    body: s.body,
    size: s.size || 'md',
  }));

  if (currentSlides.length === 0) {
    showError('This deck has no slides.');
    return;
  }

  els.statusScreen.style.display = 'none';
  els.stage.style.display = 'block';
  els.footerBar.style.display = 'flex';
  els.footerTitle.textContent = topic.title;

  renderSlideElements();
  show(0);
}

function renderSlideElements() {
  els.stage.innerHTML = currentSlides.map((slide, i) => `
    <section class="slide size-${escapeHtml(slide.size || 'md')}${i === current ? ' active' : ''}" data-index="${i}">
      <div class="text-pane">
        <div class="accent-line"></div>
        <div class="headline" ${editing ? 'contenteditable="true"' : ''}>${escapeHtml(slide.headline)}</div>
        <div class="body" ${editing ? 'contenteditable="true"' : ''}>${escapeHtml(slide.body)}</div>
      </div>
    </section>
  `).join('');

  slideCount = currentSlides.length;
  els.footerCount.textContent = `${slideCount} slides`;
}

function show(index) {
  const sections = els.stage.querySelectorAll('section.slide');
  sections.forEach((s, i) => s.classList.toggle('active', i === index));
  current = index;
  els.counter.textContent = slideCount ? `${current + 1} / ${slideCount}` : '';
}

function syncActiveSlideEdits() {
  if (!editing) return;
  const activeSection = els.stage.querySelector('section.slide.active');
  if (!activeSection || !currentSlides[current]) return;
  const headlineEl = activeSection.querySelector('.headline');
  const bodyEl = activeSection.querySelector('.body');
  currentSlides[current] = {
    ...currentSlides[current],
    headline: headlineEl.textContent.trim(),
    body: bodyEl.textContent.trim(),
  };
}

function next() {
  if (slideCount === 0) return;
  syncActiveSlideEdits();
  show(Math.min(slideCount - 1, current + 1));
}

function prev() {
  if (slideCount === 0) return;
  syncActiveSlideEdits();
  show(Math.max(0, current - 1));
}

// ─── Edit mode ───────────────────────────────────────────────────────────

function setEditControlsVisible(visible) {
  els.editBtn.style.display = visible ? 'none' : 'inline-block';
  els.prevSlideEditBtn.style.display = visible ? 'inline-block' : 'none';
  els.nextSlideEditBtn.style.display = visible ? 'inline-block' : 'none';
  els.deleteSlideBtn.style.display = visible ? 'inline-block' : 'none';
  els.saveEditBtn.style.display = visible ? 'inline-block' : 'none';
  els.cancelEditBtn.style.display = visible ? 'inline-block' : 'none';
}

function enterEditMode() {
  editing = true;
  editSnapshot = JSON.parse(JSON.stringify(currentSlides));
  setEditControlsVisible(true);
  renderSlideElements();
  show(current);
}

function cancelEditMode() {
  if (editSnapshot) {
    currentSlides = editSnapshot;
    if (current >= currentSlides.length) current = currentSlides.length - 1;
  }
  editing = false;
  editSnapshot = null;
  setEditControlsVisible(false);
  renderSlideElements();
  show(current);
}

function deleteCurrentSlide() {
  if (currentSlides.length <= 1) {
    window.alert('A deck needs at least one slide — edit its text instead of deleting the last one.');
    return;
  }
  if (!window.confirm('Delete this slide? This only takes effect once you click Save changes.')) return;
  currentSlides.splice(current, 1);
  if (current >= currentSlides.length) current = currentSlides.length - 1;
  renderSlideElements();
  show(current);
}

async function saveEdits() {
  syncActiveSlideEdits();
  els.saveEditBtn.disabled = true;
  els.saveEditBtn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/topics/update-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentTopicId,
        slides: currentSlides.map(s => ({ headline: s.headline, body: s.body })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Failed to save: ${res.status}`);
    editing = false;
    editSnapshot = null;
    setEditControlsVisible(false);
    renderDeck(data);
  } catch (err) {
    window.alert(err.message);
  } finally {
    els.saveEditBtn.disabled = false;
    els.saveEditBtn.textContent = 'Save changes';
  }
}

// ─── Load flow ───────────────────────────────────────────────────────────

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
  if (editing) return;
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

els.stage.addEventListener('click', () => { if (!editing) next(); });

els.exitLink.addEventListener('click', e => {
  if (editing && !window.confirm('Leave without saving your edits?')) {
    e.preventDefault();
  }
});

els.regenerateBtn.addEventListener('click', () => {
  const id = getTopicIdFromUrl();
  if (!id) return;
  if (editing && !window.confirm('Regenerating will discard your unsaved edits. Continue?')) return;
  els.regenerateBtn.disabled = true;
  els.regenerateBtn.textContent = 'Regenerating…';
  loadDeck(id, { forceRegenerate: true });
});

els.editBtn.addEventListener('click', enterEditMode);
els.cancelEditBtn.addEventListener('click', cancelEditMode);
els.deleteSlideBtn.addEventListener('click', deleteCurrentSlide);
els.saveEditBtn.addEventListener('click', saveEdits);
els.prevSlideEditBtn.addEventListener('click', () => { syncActiveSlideEdits(); show(Math.max(0, current - 1)); });
els.nextSlideEditBtn.addEventListener('click', () => { syncActiveSlideEdits(); show(Math.min(slideCount - 1, current + 1)); });

const topicId = getTopicIdFromUrl();
if (!topicId) {
  showError('No topic id provided.');
} else {
  loadDeck(topicId);
}
