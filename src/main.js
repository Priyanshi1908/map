/**
 * main.js — HyperMap entry point
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { HIGHLIGHT_COLOR, HIGHLIGHT_OPACITY } from './constants.js';
import { loadCityData } from './dataLoader.js';
import { CountryPicker } from './countryPicker.js';
import { findNearestCity } from './cityLookup.js';
import { UI } from './ui.js';

// Register Service Worker for offline caching
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ─── State ──────────────────────────────────────────────────────────────────

const ui     = new UI();
const picker = new CountryPicker();

let cityData     = null;
let cityLoadProm = null;

let lastHighlightId = null;
let mapReady        = false;
let pickerReady     = false;

// ─── Map ────────────────────────────────────────────────────────────────────

const map = new maplibregl.Map({
  container: 'map',
  style:     'https://tiles.openfreemap.org/styles/liberty',
  center:    [0, 20],
  zoom:      2,
  maxPitch:  0,
  attributionControl: false,
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

// ─── City data: lazy, pre-fetched on toggle hover ─────────────────────────

function ensureCityData() {
  if (cityLoadProm) return cityLoadProm;
  ui.showCityLoading(true);
  cityLoadProm = loadCityData()
    .then(d => { cityData = d; ui.showCityLoading(false); })
    .catch(err => { console.error('City load failed', err); ui.showCityLoading(false); });
  return cityLoadProm;
}

ui.onModeChange(mode => {
  if (mode === 'prefetch' || mode === 'city') ensureCityData();
  if (mode === 'country') clearHighlight();
});

// ─── Map style load ──────────────────────────────────────────────────────

map.on('load', async () => {
  // Load our Natural Earth country GeoJSON
  // Features already have numeric "id" at top level = country ID
  const geojson = await fetch('/data/countries_visible.geojson').then(r => r.json());

  map.addSource('countries', {
    type: 'geojson',
    data: geojson,
    generateId: false,  // use the "id" field already on each feature
  });

  // Invisible hit layer — queryRenderedFeatures needs a fill layer to query
  map.addLayer({
    id:     'country-hit',
    type:   'fill',
    source: 'countries',
    paint: {
      'fill-color':   '#000',
      'fill-opacity': 0,     // invisible, but still queryable
    },
  });

  // Highlight fill
  map.addLayer({
    id:     'country-highlight',
    type:   'fill',
    source: 'countries',
    paint: {
      'fill-color':   HIGHLIGHT_COLOR,
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'highlighted'], false],
        HIGHLIGHT_OPACITY,
        0,
      ],
    },
  });

  // Highlight border
  map.addLayer({
    id:     'country-highlight-border',
    type:   'line',
    source: 'countries',
    paint: {
      'line-color':   HIGHLIGHT_COLOR,
      'line-width':   ['case', ['boolean', ['feature-state', 'highlighted'], false], 1.5, 0],
      'line-opacity': 0.9,
    },
  });

  mapReady = true;

  // Picker init is now trivial (no second map)
  await picker.init(map, null, null);
  pickerReady = true;

  window.__mapReady?.();
});

// ─── Interaction handler ─────────────────────────────────────────────────

function handleInteraction(clientX, clientY) {
  if (!mapReady || !pickerReady) return;

  const t0 = performance.now();

  // Pixel on map canvas
  const rect = map.getCanvas().getBoundingClientRect();
  const px   = clientX - rect.left;
  const py   = clientY - rect.top;

  // World coordinates
  const lngLat = map.unproject([px, py]);
  const lat    = lngLat.lat;
  const lng    = lngLat.lng;

  // ── Country (queryRenderedFeatures) ──
  const country = picker.pick(px, py);

  if (country) {
    setHighlight(country.id);
  } else {
    clearHighlight();
  }

  // ── Tooltip HTML ──
  let html = '';

  if (country) {
    const flag = toFlag(country.code);
    html += `<span class="hm-flag">${flag}</span>`;
    html += `<div class="hm-country">${esc(country.name)}</div>`;
    if (country.code && country.code.length === 2 && country.code !== '-1') {
      html += `<div class="hm-code">${country.code}</div>`;
    }
  } else {
    html += `<div class="hm-country hm-ocean">Ocean / No Data</div>`;
  }

  // ── City (spatial hash) ──
  if (ui.mode === 'city' && cityData) {
    const city = findNearestCity(lat, lng, cityData);
    if (city) {
      html += `<div class="hm-city">📍 ${esc(city.name)}`;
      if (city.cc && city.cc !== '??') html += ` <span class="hm-cc">(${city.cc})</span>`;
      html += `</div>`;
      const km = city.distKm < 10
        ? city.distKm.toFixed(1)
        : Math.round(city.distKm);
      html += `<div class="hm-dist">${km} km away · ${fmtPop(city.pop)}</div>`;
    }
  }

  html += `<div class="hm-coords">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>`;

  const elapsed = performance.now() - t0;
  ui.showTiming(elapsed);
  ui.showTooltip(html, clientX, clientY);
}

// Click
map.getCanvas().addEventListener('click', e => {
  handleInteraction(e.clientX, e.clientY);
}, { passive: true });

// Touch — use touchend so pan gestures don't trigger it
map.getCanvas().addEventListener('touchend', e => {
  // Only fire for taps (not end of pans/pinches)
  if (e.changedTouches.length === 1 && e.timeStamp - (map._tapStart || 0) < 300) {
    e.preventDefault();
    const t = e.changedTouches[0];
    handleInteraction(t.clientX, t.clientY);
  }
}, { passive: false });

map.getCanvas().addEventListener('touchstart', e => {
  map._tapStart = e.timeStamp;
}, { passive: true });

// Hide tooltip on mouse leave
map.getCanvas().addEventListener('mouseleave', () => ui.hideTooltip(), { passive: true });

// ─── Country highlighting ────────────────────────────────────────────────

function setHighlight(countryId) {
  if (lastHighlightId === countryId) return;
  clearHighlight();
  map.setFeatureState({ source: 'countries', id: countryId }, { highlighted: true });
  lastHighlightId = countryId;
}

function clearHighlight() {
  if (lastHighlightId === null) return;
  map.setFeatureState({ source: 'countries', id: lastHighlightId }, { highlighted: false });
  lastHighlightId = null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function toFlag(code) {
  if (!code || code.length !== 2) return '🌍';
  try {
    const a = code.toUpperCase().charCodeAt(0) - 65;
    const b = code.toUpperCase().charCodeAt(1) - 65;
    if (a < 0 || a > 25 || b < 0 || b > 25) return '🌍';
    return String.fromCodePoint(0x1F1E6 + a, 0x1F1E6 + b);
  } catch { return '🌍'; }
}

function fmtPop(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return String(n);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
