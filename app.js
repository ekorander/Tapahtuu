/* ── Tapahtuu – Helsinki Events ─────────────────────────────────
   API: https://api.hel.fi/linkedevents/v1/
──────────────────────────────────────────────────────────────── */

// ── Config ──────────────────────────────────────────────────────
const API_BASE = 'https://api.hel.fi/linkedevents/v1/event/';
const HKI_CENTER = [60.1699, 24.9384];
const HKI_BBOX = '24.5,60.05,25.3,60.4';  // wide Helsinki metro bbox

// Category definitions with YSO keyword IDs
const CATEGORIES = [
  { id: 'all',       fi: 'Kaikki',    en: 'All',       icon: '🗺️',  color: '#ff6b2b', keyword: null },
  { id: 'music',     fi: 'Musiikki',  en: 'Music',     icon: '🎵',  color: '#e74c3c', keyword: 'yso:p1808' },
  { id: 'culture',   fi: 'Kulttuuri', en: 'Culture',   icon: '🎭',  color: '#9b59b6', keyword: 'yso:p360'  },
  { id: 'sports',    fi: 'Urheilu',   en: 'Sports',    icon: '⚽',  color: '#27ae60', keyword: 'yso:p916'  },
  { id: 'food',      fi: 'Ruoka',     en: 'Food',      icon: '🍽️', color: '#f39c12', keyword: 'yso:p3670' },
  { id: 'community', fi: 'Yhteisö',   en: 'Community', icon: '🤝',  color: '#2980b9', keyword: 'yso:p10727' },
];

const DATE_FILTERS = [
  { id: 'today',    fi: 'Tänään',       en: 'Today'        },
  { id: 'weekend',  fi: 'Viikonloppu',  en: 'This Weekend' },
  { id: 'week',     fi: 'Tämä viikko',  en: 'This Week'    },
  { id: 'month',    fi: 'Tämä kuukausi',en: 'This Month'   },
];

// ── State ────────────────────────────────────────────────────────
let state = {
  lang:       localStorage.getItem('tapahtuu-lang') || 'fi',
  category:   'all',
  dateFilter: 'today',
  events:     [],
  markers:    [],
  loading:    false,
};

let map, markerGroup, deferredInstall;

// ── i18n helper ──────────────────────────────────────────────────
const t = (obj) => {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj[state.lang] || obj.fi || obj.en || obj.sv || '';
};

const ui = {
  'loading.text':      { fi: 'Ladataan tapahtumia…',      en: 'Loading events…'        },
  'no-events.title':   { fi: 'Ei tapahtumia',              en: 'No events found'        },
  'no-events.sub':     { fi: 'Kokeile eri suodatinta.',    en: 'Try a different filter.' },
  'install.title':     { fi: 'Asenna Tapahtuu',            en: 'Install Tapahtuu'       },
  'install.sub':       { fi: 'Nopea pääsy tapahtumiin',    en: 'Quick access to events' },
  'install.btn':       { fi: 'Asenna',                     en: 'Install'                },
  'popup.more':        { fi: 'Lisätietoja →',              en: 'More info →'            },
  'popup.location':    { fi: 'Sijainti ei saatavilla',     en: 'Location unavailable'   },
  'count.events':      { fi: 'tapahtumaa',                 en: 'events'                 },
};

const str = (key) => ui[key]?.[state.lang] || ui[key]?.fi || key;

// ── Date helpers ─────────────────────────────────────────────────
function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function getDateRange(filter) {
  const now = new Date();
  const today = isoDate(now);

  if (filter === 'today') {
    return { start: today, end: today };
  }

  if (filter === 'weekend') {
    const day = now.getDay(); // 0=Sun, 6=Sat
    const diff = day === 0 ? -1 : (6 - day);
    const sat = new Date(now); sat.setDate(now.getDate() + diff);
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    // If today is Mon–Fri look forward; if Sat/Sun use current weekend
    if (day >= 1 && day <= 5) {
      return { start: isoDate(sat), end: isoDate(sun) };
    } else {
      // Current weekend
      const weekStart = day === 0 ? new Date(now) : sat;
      const weekEnd   = day === 0 ? now : sun;
      return { start: isoDate(weekStart), end: isoDate(weekEnd) };
    }
  }

  if (filter === 'week') {
    const end = new Date(now); end.setDate(now.getDate() + 6);
    return { start: today, end: isoDate(end) };
  }

  if (filter === 'month') {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: today, end: isoDate(end) };
  }

  return { start: today, end: today };
}

// ── Format helpers ───────────────────────────────────────────────
function formatDateTime(startStr, endStr) {
  if (!startStr) return '';
  const start = new Date(startStr);
  const locale = state.lang === 'fi' ? 'fi-FI' : 'en-GB';

  const dateStr = start.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  let result = `${dateStr} ${timeStr}`;
  if (endStr) {
    const end = new Date(endStr);
    if (end.toDateString() === start.toDateString()) {
      const endTime = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      result += `–${endTime}`;
    }
  }
  return result;
}

function getCategoryForEvent(event) {
  const keywords = (event.keywords || []).map((k) => k['@id'] || k.id || '');
  for (const cat of CATEGORIES.slice(1)) {
    // keyword @id is a full URL like: .../keyword/yso:p1808/...
    if (keywords.some((k) => k.includes(cat.keyword))) {
      return cat;
    }
  }
  return CATEGORIES[0]; // 'all' / default orange
}

// ── API ──────────────────────────────────────────────────────────
async function fetchEvents() {
  if (state.loading) return;
  state.loading = true;
  showLoading(true);

  const cat = CATEGORIES.find((c) => c.id === state.category);
  const { start, end } = getDateRange(state.dateFilter);

  const params = new URLSearchParams({
    format:    'json',
    start,
    end,
    bbox:      HKI_BBOX,
    page_size: '200',
    include:   'location,keywords',
    language:  state.lang,
    sort:      'start_time',
  });

  if (cat && cat.keyword) params.set('keyword', cat.keyword);

  try {
    const res = await fetch(`${API_BASE}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.events = (data.data || []).filter(hasLocation);
    renderMarkers();
    updateCount();
  } catch (err) {
    console.error('Fetch error:', err);
    showToast(state.lang === 'fi'
      ? 'Tapahtumien lataus epäonnistui. Tarkista yhteys.'
      : 'Could not load events. Check your connection.');
    state.events = [];
    renderMarkers();
    updateCount();
  } finally {
    state.loading = false;
    showLoading(false);
  }
}

function hasLocation(event) {
  try {
    const pos = event.location?.position;
    return pos && pos.coordinates && pos.coordinates.length === 2;
  } catch { return false; }
}

// ── Map ──────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: HKI_CENTER,
    zoom: 12,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  markerGroup = L.layerGroup().addTo(map);
}

function makeIcon(color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="30" height="42">
      <path d="M15 0C6.7 0 0 6.7 0 15C0 26 15 42 15 42C15 42 30 26 30 15C30 6.7 23.3 0 15 0Z"
            fill="${color}" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>
      <circle cx="15" cy="15" r="6" fill="rgba(255,255,255,0.9)"/>
    </svg>`;
  return L.divIcon({
    html: `<div style="filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6))">${svg}</div>`,
    iconSize:   [30, 42],
    iconAnchor: [15, 42],
    popupAnchor:[0, -44],
    className:  '',
  });
}

function buildPopup(event) {
  const cat = getCategoryForEvent(event);
  const name = t(event.name) || (state.lang === 'fi' ? 'Nimetön tapahtuma' : 'Unnamed event');
  const desc = t(event.short_description) || t(event.description) || '';
  const locName = t(event.location?.name) || str('popup.location');
  const time = formatDateTime(event.start_time, event.end_time);
  const url  = event.info_url ? t(event.info_url) : (event['@id'] || '');

  const truncDesc = desc.length > 160 ? desc.slice(0, 157) + '…' : desc;

  return `
    <div class="popup">
      <div class="popup-category" style="color:${cat.color};background:${cat.color}22">
        ${cat.icon} ${cat[state.lang]}
      </div>
      <div class="popup-title">${escHtml(name)}</div>
      <div class="popup-meta">
        ${time ? `<div class="popup-meta-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>${escHtml(time)}</span>
        </div>` : ''}
        <div class="popup-meta-row">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span>${escHtml(locName)}</span>
        </div>
      </div>
      ${truncDesc ? `<div class="popup-desc">${escHtml(truncDesc)}</div>` : ''}
      ${url ? `<a class="popup-link" href="${escHtml(url)}" target="_blank" rel="noopener">
        ${str('popup.more')}
      </a>` : ''}
    </div>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkers() {
  markerGroup.clearLayers();

  if (state.events.length === 0) {
    document.getElementById('no-events').classList.add('show');
    return;
  }
  document.getElementById('no-events').classList.remove('show');

  state.events.forEach((event) => {
    try {
      const [lng, lat] = event.location.position.coordinates;
      const cat = getCategoryForEvent(event);
      const marker = L.marker([lat, lng], { icon: makeIcon(cat.color) });
      marker.bindPopup(buildPopup(event), {
        maxWidth: 300,
        className: '',
      });
      markerGroup.addLayer(marker);
    } catch (e) {
      // skip malformed event
    }
  });
}

// ── UI helpers ───────────────────────────────────────────────────
function showLoading(on) {
  document.getElementById('loading').classList.toggle('hidden', !on);
  document.getElementById('loading-text').textContent = str('loading.text');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

function updateCount() {
  const el = document.getElementById('event-count');
  const n  = state.events.length;
  el.innerHTML = `<strong>${n}</strong> ${str('count.events')}`;
}

// ── Build header filters ─────────────────────────────────────────
function buildFilters() {
  // Category buttons
  const catRow = document.getElementById('cat-filters');
  catRow.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (cat.id === state.category ? ' active' : '');
    btn.dataset.id = cat.id;
    btn.innerHTML = `
      <span class="dot" style="background:${cat.color}"></span>
      ${cat[state.lang]}`;
    btn.addEventListener('click', () => {
      state.category = cat.id;
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      fetchEvents();
    });
    catRow.appendChild(btn);
  });

  // Date buttons
  const dateRow = document.getElementById('date-filters');
  dateRow.innerHTML = '';
  DATE_FILTERS.forEach((df) => {
    const btn = document.createElement('button');
    btn.className = 'date-btn' + (df.id === state.dateFilter ? ' active' : '');
    btn.dataset.id = df.id;
    btn.textContent = df[state.lang];
    btn.addEventListener('click', () => {
      state.dateFilter = df.id;
      document.querySelectorAll('.date-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      fetchEvents();
    });
    dateRow.appendChild(btn);
  });
}

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem('tapahtuu-lang', lang);
  document.querySelectorAll('.lang-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === lang));
  buildFilters();
  updateCount();
  // Re-render open popups
  renderMarkers();
  // Update static text nodes
  document.getElementById('no-events-title').textContent = str('no-events.title');
  document.getElementById('no-events-sub').textContent   = str('no-events.sub');
  document.getElementById('install-title').textContent   = str('install.title');
  document.getElementById('install-sub').textContent     = str('install.sub');
  document.getElementById('install-main-btn').textContent = str('install.btn');
  document.getElementById('loading-text').textContent    = str('loading.text');
}

// ── PWA install prompt ───────────────────────────────────────────
function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (!localStorage.getItem('tapahtuu-installed')) {
      setTimeout(() => document.getElementById('install-banner').classList.add('show'), 3000);
    }
  });

  document.getElementById('install-main-btn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') localStorage.setItem('tapahtuu-installed', '1');
    document.getElementById('install-banner').classList.remove('show');
    deferredInstall = null;
  });

  document.getElementById('install-dismiss').addEventListener('click', () => {
    document.getElementById('install-banner').classList.remove('show');
    localStorage.setItem('tapahtuu-installed', '1');
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('install-banner').classList.remove('show');
    localStorage.setItem('tapahtuu-installed', '1');
  });
}

// ── Service Worker ───────────────────────────────────────────────
function initSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  }
}

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Lang toggle buttons
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
    if (btn.dataset.lang === state.lang) btn.classList.add('active');
  });

  buildFilters();
  initMap();
  initInstall();
  initSW();
  fetchEvents();
});
