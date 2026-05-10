/**
 * My Town News — Interactive Cluster Map
 * Handles hover, click-to-navigate, and ZIP code routing.
 */

(function () {
  'use strict';

  // ── ZIP → cluster mapping ────────────────────────────────────────────
  const ZIP_TO_CLUSTER = {
    '94133': 'north-waterfront',  // North Beach / Fisherman's Wharf
    '94111': 'north-waterfront',  // Levi Plaza / Embarcadero
    '94123': 'marina-pacific-heights',
    '94115': 'marina-pacific-heights',
    '94129': 'presidio-richmond',
    '94121': 'presidio-richmond',
    '94118': 'presidio-richmond',
    '94109': 'russian-hill-nob-hill',
    '94108': 'russian-hill-nob-hill',
    '94105': 'downtown-embarcadero',
    '94104': 'downtown-embarcadero',
    '94102': 'civic-center-hayes-valley',
    '94103': 'civic-center-hayes-valley',
    '94107': 'soma-mission-bay',
    '94158': 'soma-mission-bay',
    '94117': 'haight-cole-valley',
    '94114': 'castro-noe-valley',
    '94131': 'castro-noe-valley',
    '94110': 'mission-bernal-heights',
    '94112': 'mission-bernal-heights',
    '94116': 'the-sunset',
    '94122': 'the-sunset',
    '94124': 'bayview-excelsior',
    '94134': 'bayview-excelsior',
  };

  const CLUSTER_URLS = {
    'north-waterfront': '/north-waterfront/',
  };

  // ── Map hover interaction ────────────────────────────────────────────
  const polygons = document.querySelectorAll('.cluster-polygon');
  const listItems = document.querySelectorAll('.cluster-list__item[data-cluster]');

  function setActive(slug) {
    polygons.forEach(p => p.closest('a,g').classList.remove('is-active'));
    listItems.forEach(li => li.classList.remove('is-active'));

    const poly = document.querySelector(`#map-${slug.replace(/-/g, '-')}`);
    if (poly) poly.closest('a,g') && poly.closest('a,g').classList.add('is-active');

    const li = document.querySelector(`.cluster-list__item[data-cluster="${slug}"]`);
    if (li) li.classList.add('is-active');
  }

  polygons.forEach(poly => {
    poly.addEventListener('mouseenter', () => {
      const id = poly.id.replace('map-', '');
      setActive(id);
    });

    poly.addEventListener('mouseleave', () => {
      polygons.forEach(p => p.closest('a,g').classList.remove('is-active'));
      listItems.forEach(li => li.classList.remove('is-active'));
    });
  });

  listItems.forEach(li => {
    const slug = li.dataset.cluster;
    li.addEventListener('mouseenter', () => setActive(slug));
    li.addEventListener('mouseleave', () => {
      polygons.forEach(p => p.closest('a,g').classList.remove('is-active'));
      listItems.forEach(item => item.classList.remove('is-active'));
    });
  });

  // ── ZIP code routing ─────────────────────────────────────────────────
  const zipInput  = document.getElementById('zip-input');
  const zipBtn    = document.getElementById('zip-btn');
  const zipResult = document.getElementById('zip-result');

  function handleZip() {
    const zip = (zipInput ? zipInput.value : '').trim();
    if (!zip || zip.length !== 5 || !/^\d{5}$/.test(zip)) {
      if (zipResult) {
        zipResult.style.display = 'block';
        zipResult.textContent = 'Please enter a 5-digit SF ZIP code.';
      }
      return;
    }

    const cluster = ZIP_TO_CLUSTER[zip];
    if (!cluster) {
      if (zipResult) {
        zipResult.style.display = 'block';
        zipResult.textContent = `ZIP ${zip} isn't in our coverage area yet.`;
      }
      return;
    }

    const url = CLUSTER_URLS[cluster];
    if (url) {
      window.location.href = url;
    } else {
      if (zipResult) {
        zipResult.style.display = 'block';
        zipResult.textContent = `That's the ${cluster.replace(/-/g, ' ')} cluster — launching soon!`;
      }
    }
  }

  if (zipBtn) zipBtn.addEventListener('click', handleZip);
  if (zipInput) {
    zipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleZip();
    });
  }

})();
