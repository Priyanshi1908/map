/**
 * main.js — HyperMap entry point
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { HIGHLIGHT_COLOR, HIGHLIGHT_OPACITY, DATA_BASE } from './constants.js';
import { loadCityData } from './dataLoader.js';
import { CountryPicker } from './countryPicker.js';
import { findNearestCity } from './cityLookup.js';
import { UI } from './ui.js';

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch(err =>
    console.warn('[SW] Registration failed:', err)
  );
}

// ─── State ──────────────────────────────────────────────────────────────────

const ui     = new UI();
const picker = new CountryPicker();

let cityData     = null;
let cityLoadProm = null;

let lastHighlight       = null;  // { source, id }
let mapReady            = false;
let pickerReady         = false;
let searchMarker        = null;

// ─── Map ────────────────────────────────────────────────────────────────────

const map = new maplibregl.Map({
  container: 'map',
  style:     'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  center:    [0, 20],
  zoom:      2,
  maxPitch:  0,
  attributionControl: false,
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

// ─── City data ───────────────────────────────────────────────────────────

function ensureCityData() {
  if (cityLoadProm) return cityLoadProm;
  ui.showCityLoading(true);
  cityLoadProm = loadCityData()
    .then(d => {
      cityData = d;
      ui.showCityLoading(false);
      ui.setDataSizes({
        cities: d._rawSizes?.cities ?? 0,
        grid:   d._rawSizes?.grid   ?? 0,
        names:  d._rawSizes?.names  ?? 0,
        geo:    d._rawSizes?.geo    ?? 0,
        numCities: d.numCities,
      });
      const test = findNearestCity(19.07, 72.88, d);
      console.log('[HyperMap] Cities loaded. Mumbai test:', test?.name, test?.distKm?.toFixed(1) + 'km');
    })
    .catch(err => { console.error('[HyperMap] City load failed:', err); ui.showCityLoading(false); });
  return cityLoadProm;
}

ui.onModeChange(mode => {
  if (mode === 'prefetch' || mode === 'city') ensureCityData();
  clearHighlight();
});

ui.onSearch(({ lat, lng }) => {
  if (!mapReady || !pickerReady) return;
  clearSearchMarker();
  clearHighlight();

  const zoom = map.getZoom() < 4 ? 6 : map.getZoom();
  map.jumpTo({ center: [lng, lat], zoom });

  map.once('idle', () => {
    // Build info regardless of current mode
    const sp = map.project([lng, lat]);
    const country = picker.pick(sp.x, sp.y);
    let html = '';

    if (country) {
      html += `<span class="hm-flag">${toFlag(country.code)}</span>`;
      html += `<div class="hm-country">${esc(country.name)}</div>`;
    }

    if (cityData) {
      const city = findNearestCity(lat, lng, cityData);
      if (city) {
        html += `<div class="hm-city-name">${esc(city.name)}</div>`;
        const km = city.distKm < 1  ? (city.distKm * 1000).toFixed(0) + ' m'
                 : city.distKm < 10 ? city.distKm.toFixed(1) + ' km'
                 :                    Math.round(city.distKm) + ' km';
        html += `<div class="hm-dist">${km} away · pop ${fmtPop(city.pop)}</div>`;
      }
    }

    html += `<div class="hm-coords">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>`;

    // Place a pin marker at exact spot
    const el = document.createElement('div');
    el.className = 'hm-pin';
    searchMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    // Show tooltip at the marker's screen position
    const pt   = map.project([lng, lat]);
    const rect = map.getCanvas().getBoundingClientRect();
    ui.showTooltip(html, rect.left + pt.x, rect.top + pt.y);
  });
});

// ─── Map load ────────────────────────────────────────────────────────────

map.on('load', async () => {
  // ── Countries ──
  const geoResp = await fetch('/data/countries_visible.geojson');
  const geoText = await geoResp.text();
  const countryGeojson = JSON.parse(geoText);
  ui.setDataSizes({ geo: geoText.length });

  map.addSource('countries', {
    type: 'geojson',
    data: countryGeojson,
    generateId: false,
  });

  map.addLayer({ id: 'country-hit', type: 'fill', source: 'countries',
    paint: { 'fill-color': '#000', 'fill-opacity': 0 } });

  map.addLayer({ id: 'country-highlight', type: 'fill', source: 'countries',
    paint: {
      'fill-color': HIGHLIGHT_COLOR,
      'fill-opacity': ['case', ['boolean', ['feature-state', 'highlighted'], false], HIGHLIGHT_OPACITY, 0],
    }
  });

  map.addLayer({ id: 'country-highlight-border', type: 'line', source: 'countries',
    paint: {
      'line-color': HIGHLIGHT_COLOR,
      'line-width': ['case', ['boolean', ['feature-state', 'highlighted'], false], 1.5, 0],
      'line-opacity': 0.9,
    }
  });

  // ── States / provinces ──
  const statesGeojson = await fetch('/data/states.geojson').then(r => r.json());

  map.addSource('states', {
    type: 'geojson',
    data: statesGeojson,
    generateId: false,
  });

  map.addLayer({ id: 'state-hit', type: 'fill', source: 'states',
    paint: { 'fill-color': '#000', 'fill-opacity': 0 } });

  map.addLayer({ id: 'state-highlight', type: 'fill', source: 'states',
    paint: {
      'fill-color': '#c77dff',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'highlighted'], false], 0.38, 0],
    }
  });

  map.addLayer({ id: 'state-highlight-border', type: 'line', source: 'states',
    paint: {
      'line-color': '#c77dff',
      'line-width': ['case', ['boolean', ['feature-state', 'highlighted'], false], 1.5, 0],
      'line-opacity': 0.85,
    }
  });

  // ── City boundaries ──
  const cbResp = await fetch('/data/city_boundaries.geojson');
  const cbText = await cbResp.text();
  ui.setDataSizes({ boundaries: cbText.length });
  const cbJson = JSON.parse(cbText);

  map.addSource('city-boundaries', {
    type: 'geojson',
    data: cbJson,
    generateId: false,
  });

  map.addLayer({ id: 'city-boundary-highlight', type: 'fill', source: 'city-boundaries',
    paint: {
      'fill-color': '#2ec4b6',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'highlighted'], false], 0.30, 0],
    }
  });

  map.addLayer({ id: 'city-boundary-border', type: 'line', source: 'city-boundaries',
    paint: {
      'line-color': '#2ec4b6',
      'line-width': ['case', ['boolean', ['feature-state', 'highlighted'], false], 1.5, 0],
      'line-opacity': 0.9,
    }
  });

  mapReady = true;
  await picker.init(map, null, null);
  pickerReady = true;
  window.__mapReady?.();
});

// ─── Interaction ─────────────────────────────────────────────────────────

function handleInteraction(clientX, clientY) {
  if (!mapReady || !pickerReady) return;

  const t0   = performance.now();
  const rect = map.getCanvas().getBoundingClientRect();
  const px   = clientX - rect.left;
  const py   = clientY - rect.top;
  const { lat, lng } = map.unproject([px, py]);
  const mode = ui.mode;

  let html = '';

  if (mode === 'country') {
    // ── Country mode ──
    const country = picker.pick(px, py);
    if (country) {
      setHighlight('countries', country.id);
      html += `<span class="hm-flag">${toFlag(country.code)}</span>`;
      html += `<div class="hm-country">${esc(country.name)}</div>`;
      if (country.code?.length === 2 && country.code !== '-1')
        html += `<div class="hm-code">${country.code}</div>`;
    } else {
      clearHighlight();
      html += `<div class="hm-country hm-ocean">Ocean / No Data</div>`;
    }

  } else if (mode === 'state') {
    // ── State mode ──
    const state = pickState(px, py);
    if (state) {
      setHighlight('states', state.id);
      // Also show the country this state belongs to
      const country = picker.pick(px, py);
      if (country) html += `<span class="hm-flag">${toFlag(country.code)}</span>`;
      html += `<div class="hm-country">${esc(state.name)}</div>`;
      if (state.country) html += `<div class="hm-code">${esc(state.country)}</div>`;
      if (state.type)    html += `<div class="hm-code hm-code-type">${esc(state.type)}</div>`;
    } else {
      clearHighlight();
      const country = picker.pick(px, py);
      if (country) {
        html += `<span class="hm-flag">${toFlag(country.code)}</span>`;
        html += `<div class="hm-country">${esc(country.name)}</div>`;
        html += `<div class="hm-code">No state data</div>`;
      } else {
        html += `<div class="hm-country hm-ocean">Ocean / No Data</div>`;
      }
    }

  } else {
    // ── City mode ──
    const country = picker.pick(px, py);

    if (!cityData) {
      clearHighlight();
      html += `<div class="hm-country hm-loading">Loading city data…</div>`;
    } else {
      const city = findNearestCity(lat, lng, cityData);
      if (city) {
        setHighlight('city-boundaries', city.idx);
        html += `<div class="hm-city-name">${esc(city.name)}</div>`;
        if (country)
          html += `<div class="hm-country-sub">${toFlag(country.code)} ${esc(country.name)}</div>`;
        const km = city.distKm < 1  ? (city.distKm * 1000).toFixed(0) + ' m'
                 : city.distKm < 10 ? city.distKm.toFixed(1) + ' km'
                 :                    Math.round(city.distKm) + ' km';
        html += `<div class="hm-dist">${km} away · pop ${fmtPop(city.pop)}</div>`;
      } else {
        clearHighlight();
        html += `<div class="hm-country hm-ocean">No city found</div>`;
      }
    }
  }

  html += `<div class="hm-coords">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</div>`;

  ui.showTiming(performance.now() - t0);
  ui.showTooltip(html, clientX, clientY);
}

function pickState(px, py) {
  const features = map.queryRenderedFeatures([px, py], { layers: ['state-hit'] });
  if (!features.length) return null;
  const p = features[0].properties;
  return { id: features[0].id, name: p.name, country: p.country, type: p.type };
}

// Click
map.getCanvas().addEventListener('click', e => { clearSearchMarker(); handleInteraction(e.clientX, e.clientY); }, { passive: true });

// Touch
map.getCanvas().addEventListener('touchend', e => {
  if (e.changedTouches.length === 1 && e.timeStamp - (map._tapStart || 0) < 300) {
    e.preventDefault();
    clearSearchMarker();
    const t = e.changedTouches[0];
    handleInteraction(t.clientX, t.clientY);
  }
}, { passive: false });
map.getCanvas().addEventListener('touchstart', e => { map._tapStart = e.timeStamp; }, { passive: true });
map.getCanvas().addEventListener('mouseleave', () => ui.hideTooltip(), { passive: true });

// ─── Highlighting ─────────────────────────────────────────────────────────

function setHighlight(source, featureId) {
  if (lastHighlight?.source === source && lastHighlight?.id === featureId) return;
  clearHighlight();
  map.setFeatureState({ source, id: featureId }, { highlighted: true });
  lastHighlight = { source, id: featureId };
}

function clearHighlight() {
  if (!lastHighlight) return;
  map.setFeatureState({ source: lastHighlight.source, id: lastHighlight.id }, { highlighted: false });
  lastHighlight = null;
}

function clearSearchMarker() {
  if (!searchMarker) return;
  searchMarker.remove();
  searchMarker = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
