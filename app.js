/* ── Tapahtuu – Helsinki Events ─────────────────────────────────
   API: https://api.hel.fi/linkedevents/v1/
──────────────────────────────────────────────────────────────── */

// ── Config ──────────────────────────────────────────────────────
const API_BASE         = 'https://api.hel.fi/linkedevents/v1/event/';
const EB_API_BASE      = 'https://www.eventbriteapi.com/v3/events/search/';
const EB_TOKEN         = '';
const HKI_CENTER       = [60.1699, 24.9384];
const HKI_BBOX         = '24.5,60.05,25.3,60.4';
const EVENTBRITE_COLOR = '#1abc9c';

// ── Audience filter definitions ──────────────────────────────────
const AUDIENCE_FILTERS = [
  { id: 'families', fi: 'Perheet',     en: 'Families',     icon: '👨‍👩‍👧',
    keywords: ['yso:p4363', 'yso:p13050'],
    pattern: /perhe|lapsiperhe|family|familj/i },
  { id: 'children', fi: 'Lapset',      en: 'Children',     icon: '🧒',
    keywords: ['yso:p6914', 'yso:p16485', 'yso:p1087'],
    pattern: /\blapset\b|\blasten\b|\blapsi\b|\bchild|\bkids?\b/i },
  { id: 'youth',    fi: 'Nuoret',      en: 'Young adults', icon: '🎓',
    keywords: ['yso:p11617', 'yso:p3128', 'yso:p8512'],
    pattern: /nuoret|nuoriso|nuorten|\byouth\b|young adult/i },
  { id: 'seniors',  fi: 'Seniorit',    en: 'Seniors',      icon: '🧓',
    keywords: ['yso:p2433', 'yso:p15344', 'yso:p9971'],
    pattern: /seniori|senior|eläkeläi|ikäänty/i },
  { id: 'students', fi: 'Opiskelijat', en: 'Students',     icon: '📚',
    keywords: ['yso:p16486', 'yso:p19320'],
    pattern: /opiskelij|\bstudent|yliopisto|korkeakoulu/i },
  { id: 'everyone', fi: 'Kaikille',    en: 'Everyone',     icon: '🌍',
    keywords: [], pattern: null },
];

// ── Type filter definitions ──────────────────────────────────────
const TYPE_FILTERS = [
  { id: 'music',     fi: 'Musiikki',   en: 'Music',       icon: '🎵', color: '#e74c3c',
    keywords: ['yso:p1808'],
    pattern: /musiikki|konsertti|\bmusic\b|concert|festivaali|festival|bändi|\bjazz\b|\brock\b/i },
  { id: 'culture',   fi: 'Kulttuuri',  en: 'Culture',     icon: '🎭', color: '#9b59b6',
    keywords: ['yso:p360'],
    pattern: /kulttuuri|teatteri|elokuv|culture|theatre|cinema|museo|\bmuseum\b/i },
  { id: 'sports',    fi: 'Urheilu',    en: 'Sports',      icon: '⚽', color: '#27ae60',
    keywords: ['yso:p916'],
    pattern: /urheilu|liikunta|\bsport|juoksu|hiihto|futis|jalkapallo|tennis|uinti/i },
  { id: 'food',      fi: 'Ruoka',      en: 'Food',        icon: '🍽️', color: '#f39c12',
    keywords: ['yso:p3670'],
    pattern: /\bruoka\b|ravintola|\bfood\b|restaurant|kokkaus|viini|\bolut\b/i },
  { id: 'community', fi: 'Yhteisö',    en: 'Community',   icon: '🤝', color: '#2980b9',
    keywords: ['yso:p10727'],
    pattern: /yhteisö|community|naapurus|talkoot|vapaaehtoinen|volunteer/i },
  { id: 'art',       fi: 'Taide',      en: 'Art',         icon: '🎨', color: '#8e44ad',
    keywords: ['yso:p1235', 'yso:p8113', 'yso:p2716', 'yso:p4028'],
    pattern: /\btaide\b|näyttely|galleria|\bart\b|gallery|taiteilija|maalaus|valokuva/i },
  { id: 'tech',      fi: 'Teknologia', en: 'Technology',  icon: '💻', color: '#16a085',
    keywords: ['yso:p3442', 'yso:p17301', 'yso:p2739', 'yso:p6503'],
    pattern: /teknologia|ohjelmointi|\btech\b|hackathon|startup|\bkoodi\b|tekoäly/i },
  { id: 'outdoor',   fi: 'Ulkoilma',   en: 'Outdoor',     icon: '🌲', color: '#2ecc71',
    keywords: ['yso:p9121', 'yso:p3382', 'yso:p527', 'yso:p5765', 'yso:p1425'],
    pattern: /ulkoilma|luonto|\bpuisto\b|outdoor|nature|\bretki\b|kävely|pyöräily|vaellus/i },
];

const DATE_FILTERS = [
  { id: 'today',   fi: 'Tänään',        en: 'Today'        },
  { id: 'weekend', fi: 'Viikonloppu',   en: 'This Weekend' },
  { id: 'week',    fi: 'Tämä viikko',   en: 'This Week'    },
  { id: 'month',   fi: 'Tämä kuukausi', en: 'This Month'   },
];

// ── State ────────────────────────────────────────────────────────
let state = {
  lang:       localStorage.getItem('tapahtuu-lang') || 'fi',
  audience:   new Set(),
  type:       new Set(),
  dateFilter: 'today',
  events:     [],
  loading:    false,
};

let map, markerGroup, deferredInstall;

// ── Cache helpers ─────────────────────────────────────────────────
const CACHE_TTL = 60 * 60 * 1000;

function saveCache(key, events) {
  try {
    const serial = events.map(ev => ({
      ...ev,
      _audiences: ev._audiences ? [...ev._audiences] : [],
      _types:     ev._types     ? [...ev._types]     : [],
    }));
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), events: serial }));
  } catch { /* quota exceeded */ }
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const { ts, events } = JSON.parse(raw);
    if (Date.now() - ts >= CACHE_TTL) return [];
    return events.map(ev => ({
      ...ev,
      _audiences: new Set(ev._audiences || []),
      _types:     new Set(ev._types     || []),
    }));
  } catch { return []; }
}

// ── i18n ─────────────────────────────────────────────────────────
const t = (obj) => {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj[state.lang] || obj.fi || obj.en || obj.sv || '';
};

const ui = {
  'loading.text':    { fi: 'Ladataan tapahtumia…',    en: 'Loading events…'         },
  'no-events.title': { fi: 'Ei tapahtumia',            en: 'No events found'         },
  'no-events.sub':   { fi: 'Kokeile eri suodatinta.',  en: 'Try a different filter.' },
  'install.title':   { fi: 'Asenna Tapahtuu',          en: 'Install Tapahtuu'        },
  'install.sub':     { fi: 'Nopea pääsy tapahtumiin',  en: 'Quick access to events'  },
  'install.btn':     { fi: 'Asenna',                   en: 'Install'                 },
  'popup.more':      { fi: 'Lisätietoja →',            en: 'More info →'             },
  'popup.location':  { fi: 'Sijainti ei saatavilla',   en: 'Location unavailable'    },
  'count.events':    { fi: 'tapahtumaa',               en: 'events'                  },
  'filter.who':      { fi: 'Ketkä',                    en: 'Who'                     },
  'filter.what':     { fi: 'Mitä',                     en: 'What'                    },
  'filter.active':   { fi: 'suodatinta',               en: 'filters'                 },
};

const str = (key) => ui[key]?.[state.lang] || ui[key]?.fi || key;

// ── Date helpers ─────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().split('T')[0]; }

function getDateRange(filter) {
  const now = new Date();
  const today = isoDate(now);
  const nowIso = now.toISOString();

  if (filter === 'today')   return { start: nowIso, end: today };
  if (filter === 'weekend') {
    const day = now.getDay();
    const diff = day === 0 ? -1 : (6 - day);
    const sat = new Date(now); sat.setDate(now.getDate() + diff);
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    return day >= 1 && day <= 5
      ? { start: isoDate(sat), end: isoDate(sun) }
      : { start: nowIso,       end: isoDate(sun) };
  }
  if (filter === 'week') {
    const end = new Date(now); end.setDate(now.getDate() + 6);
    return { start: nowIso, end: isoDate(end) };
  }
  if (filter === 'month') {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: nowIso, end: isoDate(end) };
  }
  return { start: nowIso, end: today };
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
    if (end.toDateString() === start.toDateString())
      result += `–${end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
  }
  return result;
}

// ── Event tagging ─────────────────────────────────────────────────
function tagEvent(event) {
  const ids = [
    ...(event.keywords || []),
    ...(event.audience || []),
  ].map(k => {
    const raw = k['@id'] || k.id || '';
    const m = raw.match(/yso:p\d+/);
    return m ? m[0] : raw;
  });

  const text = [t(event.name), t(event.short_description), t(event.description)]
    .filter(Boolean).join(' ');

  const audiences = new Set();
  for (const af of AUDIENCE_FILTERS) {
    if (af.id === 'everyone') continue;
    if (af.keywords.some(kw => ids.some(id => id.includes(kw))) ||
        (af.pattern && af.pattern.test(text))) {
      audiences.add(af.id);
    }
  }
  event._audiences = audiences.size > 0 ? audiences : new Set(['everyone']);

  const types = new Set();
  for (const tf of TYPE_FILTERS) {
    if (tf.keywords.some(kw => ids.some(id => id.includes(kw))) ||
        (tf.pattern && tf.pattern.test(text))) {
      types.add(tf.id);
    }
  }
  event._types = types;

  return event;
}

// ── Client-side filtering ─────────────────────────────────────────
function applyFilters(events) {
  return events.filter(ev => {
    if (state.audience.size > 0 &&
        ![...state.audience].some(a  => ev._audiences?.has(a)))  return false;
    if (state.type.size > 0 &&
        ![...state.type].some(ty => ev._types?.has(ty)))         return false;
    return true;
  });
}

// ── Pin colour ───────────────────────────────────────────────────
function getCategoryForEvent(event) {
  if (event._source === 'eventbrite')
    return { id: 'eventbrite', fi: 'Eventbrite', en: 'Eventbrite', icon: '🎟️', color: EVENTBRITE_COLOR };
  if (event._types?.size > 0) {
    const tf = TYPE_FILTERS.find(f => event._types.has(f.id));
    if (tf) return tf;
  }
  return { id: 'other', fi: 'Tapahtuma', en: 'Event', icon: '📍', color: '#ff6b2b' };
}

// ── Eventbrite ───────────────────────────────────────────────────
async function geocodeAddress(address) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { 'Accept-Language': 'fi,en' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
  } catch { return null; }
}

async function fetchEventbriteEvents() {
  const { start, end } = getDateRange(state.dateFilter);
  const endDt = end.includes('T') ? end : `${end}T23:59:59Z`;
  const params = new URLSearchParams({
    'location.address':       'Helsinki, Finland',
    'location.within':        '10km',
    'start_date.range_start': start,
    'start_date.range_end':   endDt,
    'expand':                 'venue',
  });
  const url = `${EB_API_BASE}?${params}`;
  console.log('[Tapahtuu] Fetching Eventbrite:', url);
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    const headers = EB_TOKEN ? { 'Authorization': `Bearer ${EB_TOKEN}` } : {};
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(tid);
    if (!res.ok) {
      console.warn('[Tapahtuu] Eventbrite HTTP', res.status,
        (res.status === 401 || res.status === 403)
          ? '— set EB_TOKEN in app.js to enable Eventbrite events' : '— skipping');
      return [];
    }
    const data = await res.json();
    const now = new Date();
    const out = [];
    let geocoded = 0;
    for (const ev of (data.events || [])) {
      const venue = ev.venue;
      let lat, lng;
      if (venue?.latitude && venue?.longitude) {
        lat = parseFloat(venue.latitude); lng = parseFloat(venue.longitude);
      } else if (venue && geocoded < 5) {
        const addr = [venue.address?.address_1, venue.address?.city].filter(Boolean).join(', ');
        if (addr) {
          const c = await geocodeAddress(addr);
          if (c) { lat = c.lat; lng = c.lng; geocoded++; }
        }
      }
      if (!lat || !lng) continue;
      const ct = ev.end?.utc || ev.start?.utc;
      if (ct && new Date(ct) <= now) continue;
      out.push(tagEvent({
        _source:           'eventbrite',
        name:              { fi: ev.name?.text || '', en: ev.name?.text || '' },
        short_description: { fi: ev.summary || '', en: ev.summary || '' },
        start_time:        ev.start?.utc,
        end_time:          ev.end?.utc,
        info_url:          { fi: ev.url, en: ev.url },
        location: { position: { coordinates: [lng, lat] }, name: { fi: venue.name || '', en: venue.name || '' } },
        keywords: [],
      }));
    }
    return out;
  } catch (err) {
    console.warn('[Tapahtuu] Eventbrite fetch failed:', err.message);
    return [];
  }
}

// ── API ──────────────────────────────────────────────────────────
async function fetchEvents() {
  if (state.loading) return;
  state.loading = true;

  const { start, end } = getDateRange(state.dateFilter);
  const cacheKey = `tapahtuu-${state.dateFilter}`;

  const cached = loadCache(cacheKey);
  if (cached.length) {
    state.events = cached;
    renderMarkers();
    updateCount();
    console.log(`[Tapahtuu] Cache hit: ${cached.length} events`);
  } else {
    showLoading(true, false);
  }

  const params = new URLSearchParams({
    format:    'json', start, end,
    bbox:      HKI_BBOX,
    page_size: '100',
    include:   'location,keywords',
    sort:      'start_time',
  });

  const firstUrl = `${API_BASE}?${params}`;
  const cutoff   = new Date();
  const MAX_PAGES = 5;
  let helEvents = [], ebEvents = [];

  function commitToMap() {
    state.events = [...helEvents, ...ebEvents].sort(
      (a, b) => new Date(a.start_time || 0) - new Date(b.start_time || 0)
    );
    renderMarkers();
    updateCount();
    showLoading(false, false);
  }

  function filterAndTag(evs) {
    return evs
      .filter(ev => { try { return ev.location?.position?.coordinates?.length === 2; } catch { return false; } })
      .filter(ev => { const ts = ev.end_time || ev.start_time; return !ts || new Date(ts) > cutoff; })
      .map(tagEvent);
  }

  const helPromise = (async () => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10000);
      console.log('[Tapahtuu] Fetching Helsinki page 1:', firstUrl);
      const res = await fetch(firstUrl, { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      helEvents = filterAndTag(data.data || []);
      commitToMap();
      console.log(`[Tapahtuu] Helsinki page 1: ${helEvents.length}`);
      let nextUrl = data.meta?.next, page = 2;
      while (nextUrl && page <= MAX_PAGES) {
        const r = await fetch(nextUrl);
        if (!r.ok) break;
        const d = await r.json();
        const more = filterAndTag(d.data || []);
        helEvents = [...helEvents, ...more];
        commitToMap();
        console.log(`[Tapahtuu] Helsinki page ${page}: +${more.length} → ${helEvents.length}`);
        nextUrl = d.meta?.next; page++;
      }
    } catch (err) {
      console.error('[Tapahtuu] Helsinki error:', err.name, err.message);
      if (!cached.length && !ebEvents.length) {
        const isTimeout = err.name === 'AbortError';
        showLoading(false, state.lang === 'fi'
          ? (isTimeout ? 'Yhteys aikakatkaistiin. Tarkista verkko.' : `Lataus epäonnistui. (${err.message})`)
          : (isTimeout ? 'Request timed out. Check your network.'   : `Could not load events. (${err.message})`));
      }
    }
  })();

  const ebPromise = (async () => {
    ebEvents = await fetchEventbriteEvents();
    commitToMap();
    console.log(`[Tapahtuu] Eventbrite: ${ebEvents.length}`);
  })();

  try {
    await Promise.all([helPromise, ebPromise]);
    if (state.events.length) saveCache(cacheKey, state.events);
    console.log(`[Tapahtuu] Done — Helsinki: ${helEvents.length} | Eventbrite: ${ebEvents.length} | Total: ${state.events.length}`);
  } finally {
    state.loading = false;
  }
}

// ── Map ──────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center: HKI_CENTER, zoom: 12, zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);
  markerGroup = L.layerGroup().addTo(map);
}

function makeIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="30" height="42">
    <path d="M15 0C6.7 0 0 6.7 0 15C0 26 15 42 15 42C15 42 30 26 30 15C30 6.7 23.3 0 15 0Z"
          fill="${color}" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>
    <circle cx="15" cy="15" r="6" fill="rgba(255,255,255,0.9)"/></svg>`;
  return L.divIcon({
    html: `<div style="filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6))">${svg}</div>`,
    iconSize: [30,42], iconAnchor: [15,42], popupAnchor: [0,-44], className: '',
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function buildPopup(event) {
  const cat = getCategoryForEvent(event);
  const name    = t(event.name) || (state.lang === 'fi' ? 'Nimetön tapahtuma' : 'Unnamed event');
  const desc    = t(event.short_description) || t(event.description) || '';
  const locName = t(event.location?.name) || str('popup.location');
  const time    = formatDateTime(event.start_time, event.end_time);
  const url     = event.info_url ? t(event.info_url) : (event['@id'] || '');
  const trunc   = desc.length > 160 ? desc.slice(0,157) + '…' : desc;
  return `<div class="popup">
    <div class="popup-category" style="color:${cat.color};background:${cat.color}22">${cat.icon} ${cat[state.lang]}</div>
    <div class="popup-title">${escHtml(name)}</div>
    <div class="popup-meta">
      ${time ? `<div class="popup-meta-row">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg><span>${escHtml(time)}</span></div>` : ''}
      <div class="popup-meta-row">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg><span>${escHtml(locName)}</span></div>
    </div>
    ${trunc ? `<div class="popup-desc">${escHtml(trunc)}</div>` : ''}
    ${url ? `<a class="popup-link" href="${escHtml(url)}" target="_blank" rel="noopener">${str('popup.more')}</a>` : ''}
  </div>`;
}

function renderMarkers() {
  markerGroup.clearLayers();
  const visible = applyFilters(state.events);
  document.getElementById('no-events').classList.toggle('show', visible.length === 0);
  visible.forEach(event => {
    try {
      const [lng, lat] = event.location.position.coordinates;
      const cat = getCategoryForEvent(event);
      const marker = L.marker([lat, lng], { icon: makeIcon(cat.color) });
      marker.bindPopup(buildPopup(event), { maxWidth: 300, className: '' });
      markerGroup.addLayer(marker);
    } catch { /* skip malformed */ }
  });
}

// ── UI helpers ───────────────────────────────────────────────────
function showLoading(on, errorMsg) {
  const el = document.getElementById('loading');
  const textEl = document.getElementById('loading-text');
  const spinner = el.querySelector('.spinner');
  if (on) {
    el.classList.remove('hidden'); spinner.style.display = '';
    textEl.textContent = str('loading.text'); textEl.style.color = '';
  } else if (errorMsg) {
    el.classList.remove('hidden'); spinner.style.display = 'none';
    textEl.textContent = errorMsg; textEl.style.color = '#ff6b6b';
    setTimeout(() => el.classList.add('hidden'), 6000);
  } else {
    el.classList.add('hidden');
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

function updateCount() {
  const visible     = applyFilters(state.events);
  const activeCount = state.audience.size + state.type.size;

  const countEl = document.getElementById('event-count');
  if (activeCount > 0 && visible.length < state.events.length) {
    countEl.innerHTML = `<strong>${visible.length}</strong><span class="count-total">/${state.events.length}</span> ${str('count.events')}`;
  } else {
    countEl.innerHTML = `<strong>${visible.length}</strong> ${str('count.events')}`;
  }

  const clearBtn   = document.getElementById('filter-clear-btn');
  const clearLabel = document.getElementById('filter-clear-label');
  if (clearBtn) clearBtn.style.display = activeCount > 0 ? 'flex' : 'none';
  if (clearLabel) clearLabel.textContent = `${activeCount} ${str('filter.active')}`;
}

// ── Filters UI ───────────────────────────────────────────────────
function buildFilters() {
  const lang = state.lang;

  const audienceLabel = document.getElementById('audience-label');
  const typeLabel     = document.getElementById('type-label');
  if (audienceLabel) audienceLabel.textContent = str('filter.who');
  if (typeLabel)     typeLabel.textContent     = str('filter.what');

  const audienceRow = document.getElementById('audience-filters');
  if (audienceRow) {
    audienceRow.innerHTML = '';
    AUDIENCE_FILTERS.forEach(af => {
      const btn = document.createElement('button');
      btn.className = 'chip audience-chip' + (state.audience.has(af.id) ? ' active' : '');
      btn.textContent = `${af.icon} ${af[lang]}`;
      btn.addEventListener('click', () => {
        state.audience.has(af.id) ? state.audience.delete(af.id) : state.audience.add(af.id);
        btn.classList.toggle('active', state.audience.has(af.id));
        renderMarkers(); updateCount();
      });
      audienceRow.appendChild(btn);
    });
  }

  const typeRow = document.getElementById('type-filters');
  if (typeRow) {
    typeRow.innerHTML = '';
    TYPE_FILTERS.forEach(tf => {
      const btn = document.createElement('button');
      btn.className = 'chip type-chip' + (state.type.has(tf.id) ? ' active' : '');
      btn.style.setProperty('--chip-color', tf.color);
      btn.textContent = `${tf.icon} ${tf[lang]}`;
      btn.addEventListener('click', () => {
        state.type.has(tf.id) ? state.type.delete(tf.id) : state.type.add(tf.id);
        btn.classList.toggle('active', state.type.has(tf.id));
        renderMarkers(); updateCount();
      });
      typeRow.appendChild(btn);
    });
  }

  const dateRow = document.getElementById('date-filters');
  if (dateRow) {
    dateRow.innerHTML = '';
    DATE_FILTERS.forEach(df => {
      const btn = document.createElement('button');
      btn.className = 'date-btn' + (df.id === state.dateFilter ? ' active' : '');
      btn.textContent = df[lang];
      btn.addEventListener('click', () => {
        state.dateFilter = df.id;
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        fetchEvents();
      });
      dateRow.appendChild(btn);
    });
  }
}

function clearAllFilters() {
  state.audience.clear(); state.type.clear();
  buildFilters(); renderMarkers(); updateCount();
}

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem('tapahtuu-lang', lang);
  document.querySelectorAll('.lang-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === lang));
  buildFilters(); updateCount(); renderMarkers();
  document.getElementById('no-events-title').textContent  = str('no-events.title');
  document.getElementById('no-events-sub').textContent    = str('no-events.sub');
  document.getElementById('install-title').textContent    = str('install.title');
  document.getElementById('install-sub').textContent      = str('install.sub');
  document.getElementById('install-main-btn').textContent = str('install.btn');
  document.getElementById('loading-text').textContent     = str('loading.text');
}

// ── PWA ──────────────────────────────────────────────────────────
function initInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstall = e;
    if (!localStorage.getItem('tapahtuu-installed'))
      setTimeout(() => document.getElementById('install-banner').classList.add('show'), 3000);
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

function initSW() {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

// ── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
    if (btn.dataset.lang === state.lang) btn.classList.add('active');
  });
  document.getElementById('filter-clear-btn')?.addEventListener('click', clearAllFilters);
  buildFilters();
  initSW();
  initInstall();
  fetchEvents();
});
