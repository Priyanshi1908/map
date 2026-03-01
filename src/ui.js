/**
 * ui.js
 * Tooltip + mode toggle + timing display.
 * Single DOM element, GPU-composited positioning, zero layout thrash.
 */

export class UI {
  constructor() {
    this._tooltip     = null;
    this._timingEl    = null;
    this._modeToggle  = null;
    this._cityLoading = null;
    this._searchEl    = null;
    this._mode        = 'country'; // 'country' | 'state' | 'city'
    this._onModeChange = null;
    this._onSearch     = null;

    this._build();
  }

  get mode() { return this._mode; }

  onModeChange(fn) { this._onModeChange = fn; }
  onSearch(fn)     { this._onSearch = fn; }

  showTooltip(html, x, y) {
    const el = this._tooltip;
    el.innerHTML = html;

    // Keep tooltip inside viewport
    const margin = 16;
    const tw = el.offsetWidth || 200;
    const th = el.offsetHeight || 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let tx = x + 14;
    let ty = y - 10;

    if (tx + tw > vw - margin) tx = x - tw - 14;
    if (ty + th > vh - margin) ty = y - th - 10;
    if (ty < margin) ty = margin;
    if (tx < margin) tx = margin;

    el.style.transform = `translate(${tx}px,${ty}px)`;
    el.style.opacity   = '1';
    el.style.visibility = 'visible';
  }

  hideTooltip() {
    const el = this._tooltip;
    el.style.opacity    = '0';
    el.style.visibility = 'hidden';
  }

  showTiming(ms) {
    const s = ms < 1 ? ms.toFixed(2) + ' ms' : ms.toFixed(1) + ' ms';
    this._timingEl.textContent = s;
    const el = document.getElementById('hs-click');
    if (el) el.textContent = s;
  }

  showCityLoading(visible) {
    this._cityLoading.style.opacity = visible ? '1' : '0';
  }

  _build() {
    // ── Tooltip ──
    const tooltip = document.createElement('div');
    tooltip.id = 'hm-tooltip';
    tooltip.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'pointer-events:none',
      'z-index:1000',
      'opacity:0',
      'visibility:hidden',
      'will-change:transform',
      'transition:opacity 0.1s ease',
    ].join(';');
    document.body.appendChild(tooltip);
    this._tooltip = tooltip;

    // ── Controls bar ──
    const bar = document.createElement('div');
    bar.id = 'hm-bar';
    bar.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:999',
      'display:flex',
      'align-items:center',
      'gap:10px',
    ].join(';');
    document.body.appendChild(bar);

    // Timing chip
    const timing = document.createElement('div');
    timing.id = 'hm-timing';
    timing.textContent = '—';
    bar.appendChild(timing);
    this._timingEl = timing;

    // 3-way segmented mode control
    const seg = document.createElement('div');
    seg.id = 'hm-seg';
    seg.innerHTML = `
      <button class="hm-seg-btn active" data-mode="country">Country</button>
      <button class="hm-seg-btn"        data-mode="state">State</button>
      <button class="hm-seg-btn"        data-mode="city">City</button>
    `;
    bar.appendChild(seg);
    this._modeToggle = seg;

    seg.addEventListener('click', e => {
      const btn = e.target.closest('.hm-seg-btn');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === this._mode) return;
      seg.querySelectorAll('.hm-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._mode = mode;
      if (this._onModeChange) this._onModeChange(mode);
    });

    // Prefetch city data when hovering the City button
    seg.querySelector('[data-mode="city"]').addEventListener('mouseenter', () => {
      if (this._onModeChange) this._onModeChange('prefetch');
    }, { once: true });

    // City loading spinner
    const loading = document.createElement('div');
    loading.id = 'hm-city-loading';
    loading.textContent = 'Loading cities…';
    loading.style.opacity = '0';
    bar.appendChild(loading);
    this._cityLoading = loading;

    // ── Place search bar (top-left) ──
    const search = document.createElement('div');
    search.id = 'hm-search';
    search.innerHTML = `
      <div id="hm-search-place">
        <svg class="hm-search-icon" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7.5" cy="7.5" r="5" stroke="#9a8c98" stroke-width="1.8"/>
          <line x1="11.2" y1="11.2" x2="16" y2="16" stroke="#9a8c98" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <input id="hm-search-input" class="hm-search-field" type="text"
               autocomplete="off" spellcheck="false" placeholder="Search any place…" />
        <button id="hm-search-clear" title="Clear">✕</button>
      </div>
      <div class="hm-search-divider"></div>
      <div id="hm-search-coords">
        <span class="hm-coord-label">Lat</span>
        <input id="hm-coord-lat" class="hm-coord-field" type="number"
               step="any" min="-90" max="90" autocomplete="off" placeholder="0.0000" />
        <span class="hm-coord-dot"></span>
        <span class="hm-coord-label">Lng</span>
        <input id="hm-coord-lng" class="hm-coord-field" type="number"
               step="any" min="-180" max="180" autocomplete="off" placeholder="0.0000" />
        <button id="hm-coord-btn" title="Go">↵</button>
      </div>
      <div id="hm-search-drop"></div>
    `;
    document.body.appendChild(search);
    this._searchEl = search;

    const input = search.querySelector('#hm-search-input');
    const clear  = search.querySelector('#hm-search-clear');
    const drop   = search.querySelector('#hm-search-drop');

    const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let _debounce = null;
    let _suggestions = [];
    let _activeIdx = -1;
    let _abortCtrl = null;

    const hideDrop = () => {
      drop.style.display = 'none';
      _activeIdx = -1;
    };

    const renderDrop = () => {
      if (!_suggestions.length) { hideDrop(); return; }
      drop.innerHTML = _suggestions.map((s, i) => `
        <div class="hm-drop-item${i === _activeIdx ? ' hm-drop-active' : ''}" data-idx="${i}">
          <span class="hm-drop-icon">${s.icon}</span>
          <span class="hm-drop-text">
            <span class="hm-drop-main">${_esc(s.name)}</span>
            ${s.sub ? `<span class="hm-drop-sub">${_esc(s.sub)}</span>` : ''}
          </span>
        </div>
      `).join('');
      drop.style.display = 'block';
      drop.querySelectorAll('.hm-drop-item').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          selectIdx(parseInt(el.dataset.idx));
        });
      });
    };

    const selectIdx = idx => {
      const s = _suggestions[idx];
      if (!s) return;
      input.value = s.name + (s.sub ? ', ' + s.sub : '');
      clear.style.display = 'flex';
      hideDrop();
      input.blur();
      if (this._onSearch) this._onSearch({ lat: s.lat, lng: s.lng });
    };

    const typeIcon = (cls, type) => {
      if (type === 'country' || cls === 'boundary' && type === 'administrative') return '🌍';
      if (['city','town'].includes(type)) return '🏙️';
      if (['village','hamlet','suburb'].includes(type)) return '🏘️';
      if (cls === 'natural') return '🏔️';
      if (cls === 'amenity') return '📍';
      return '📌';
    };

    const doSearch = async q => {
      q = q.trim();
      if (q.length < 2) { hideDrop(); return; }
      if (_abortCtrl) _abortCtrl.abort();
      _abortCtrl = new AbortController();
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`;
        const resp = await fetch(url, {
          signal: _abortCtrl.signal,
          headers: { 'Accept-Language': 'en' },
        });
        const results = await resp.json();
        _suggestions = results.map(r => {
          const a = r.address || {};
          const name = a.city || a.town || a.village || a.county || a.state || r.name || r.display_name.split(',')[0].trim();
          const parts = [];
          if (a.state && a.state !== name) parts.push(a.state);
          if (a.country) parts.push(a.country);
          return {
            name,
            sub:  parts.join(', '),
            icon: typeIcon(r.class, r.type),
            lat:  parseFloat(r.lat),
            lng:  parseFloat(r.lon),
          };
        });
        _activeIdx = -1;
        renderDrop();
      } catch (err) {
        if (err.name !== 'AbortError') hideDrop();
      }
    };

    input.addEventListener('input', () => {
      const q = input.value;
      clear.style.display = q ? 'flex' : 'none';
      clearTimeout(_debounce);
      if (!q.trim()) { hideDrop(); return; }
      _debounce = setTimeout(() => doSearch(q), 280);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _activeIdx = Math.min(_activeIdx + 1, _suggestions.length - 1);
        renderDrop();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _activeIdx = Math.max(_activeIdx - 1, 0);
        renderDrop();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (_activeIdx >= 0) selectIdx(_activeIdx);
        else if (_suggestions.length) selectIdx(0);
        else doSearch(input.value);
      } else if (e.key === 'Escape') {
        hideDrop();
        input.blur();
      }
    });

    input.addEventListener('blur', () => setTimeout(hideDrop, 160));
    input.addEventListener('focus', () => { if (_suggestions.length) renderDrop(); });

    clear.addEventListener('click', () => {
      input.value = '';
      clear.style.display = 'none';
      _suggestions = [];
      hideDrop();
      input.focus();
    });

    // ── Lat / lng coordinate inputs ──
    const latInput = search.querySelector('#hm-coord-lat');
    const lngInput = search.querySelector('#hm-coord-lng');
    const coordBtn = search.querySelector('#hm-coord-btn');
    const coordRow = search.querySelector('#hm-search-coords');

    const fireCoords = () => {
      const lat = parseFloat(latInput.value);
      const lng = parseFloat(lngInput.value);
      const valid = !isNaN(lat) && !isNaN(lng)
                 && lat >= -90 && lat <= 90
                 && lng >= -180 && lng <= 180;
      if (!valid) {
        coordRow.classList.add('hm-coords-error');
        setTimeout(() => coordRow.classList.remove('hm-coords-error'), 400);
        if (isNaN(lat) || lat < -90 || lat > 90) latInput.focus();
        else lngInput.focus();
        return;
      }
      latInput.blur(); lngInput.blur();
      if (this._onSearch) this._onSearch({ lat, lng });
    };

    latInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); lngInput.focus(); lngInput.select(); }
    });
    lngInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); fireCoords(); }
    });
    coordBtn.addEventListener('click', fireCoords);

    // ── Stats panel (bottom-left) ──
    const stats = document.createElement('div');
    stats.id = 'hm-stats';
    stats.innerHTML = `
      <div class="hm-stat-row"><span class="hm-stat-label">Last click</span><span class="hm-stat-val" id="hs-click">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">cities.bin</span><span class="hm-stat-val" id="hs-cities">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">city_grid.bin</span><span class="hm-stat-val" id="hs-grid">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">city_names.bin</span><span class="hm-stat-val" id="hs-names">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">city_boundaries</span><span class="hm-stat-val" id="hs-bounds">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">countries.geojson</span><span class="hm-stat-val" id="hs-geo">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">Total data</span><span class="hm-stat-val" id="hs-total">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">Cities loaded</span><span class="hm-stat-val" id="hs-ncities">—</span></div>
    `;
    document.body.appendChild(stats);
    this._statsEl = stats;
  }

  /** Update stats panel. Pass only the sizes you have; zeros are skipped. */
  setDataSizes(sizes) {
    const fmt = b => b >= 1024*1024
      ? (b/1024/1024).toFixed(2) + ' MB'
      : b > 0 ? (b/1024).toFixed(1) + ' KB' : '—';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (sizes.cities)     set('hs-cities', fmt(sizes.cities));
    if (sizes.grid)       set('hs-grid',   fmt(sizes.grid));
    if (sizes.names)      set('hs-names',  fmt(sizes.names));
    if (sizes.boundaries) set('hs-bounds', fmt(sizes.boundaries));
    if (sizes.geo)        set('hs-geo',    fmt(sizes.geo));
    // Track running total in dataset attribute
    const panel = this._statsEl;
    if (panel) {
      const prev = JSON.parse(panel.dataset.sizes || '{}');
      const merged = {
        cities:     sizes.cities     || prev.cities     || 0,
        grid:       sizes.grid       || prev.grid       || 0,
        names:      sizes.names      || prev.names      || 0,
        boundaries: sizes.boundaries || prev.boundaries || 0,
        geo:        sizes.geo        || prev.geo        || 0,
      };
      panel.dataset.sizes = JSON.stringify(merged);
      const total = merged.cities + merged.grid + merged.names + merged.boundaries + merged.geo;
      set('hs-total', fmt(total));
    }
    if (sizes.numCities) set('hs-ncities', sizes.numCities.toLocaleString() + ' cities');
  }
}

// ── Style injection ──────────────────────────────────────────────────────────

const css = `
  /* ── Tooltip ────────────────────────────────────────────────────── */
  #hm-tooltip {
    background: rgba(255, 255, 255, 0.97);
    color: #1a1a2e;
    border-radius: 20px;
    padding: 14px 18px;
    font-family: 'Nunito', system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    font-weight: 600;
    box-shadow:
      0 12px 40px rgba(0, 0, 0, 0.12),
      0 2px 8px rgba(0, 0, 0, 0.06);
    max-width: 230px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1.5px solid rgba(0, 0, 0, 0.06);
  }

  #hm-tooltip .hm-flag {
    font-size: 28px;
    margin-bottom: 8px;
    display: block;
    line-height: 1;
  }

  #hm-tooltip .hm-country {
    font-size: 16px;
    font-weight: 800;
    color: #1a1a2e;
    letter-spacing: -0.3px;
    margin-bottom: 2px;
  }

  #hm-tooltip .hm-ocean {
    color: #c4c1d4 !important;
    font-weight: 700;
  }

  #hm-tooltip .hm-code {
    font-size: 11px;
    font-weight: 700;
    color: #b8b2c8;
    margin-top: 3px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  #hm-tooltip .hm-code-type {
    color: #c77dff;
    letter-spacing: 0.8px;
  }

  #hm-tooltip .hm-loading {
    color: #c77dff !important;
    font-size: 14px;
    font-weight: 700;
  }

  #hm-tooltip .hm-city-name {
    font-size: 17px;
    font-weight: 900;
    color: #1a1a2e;
    letter-spacing: -0.4px;
    margin-bottom: 5px;
  }

  #hm-tooltip .hm-country-sub {
    font-size: 12px;
    color: #9a8c98;
    font-weight: 700;
    margin-bottom: 2px;
  }

  #hm-tooltip .hm-dist {
    font-size: 12px;
    font-weight: 700;
    color: #2ec4b6;
    margin-top: 5px;
  }

  #hm-tooltip .hm-coords {
    font-size: 10px;
    font-weight: 600;
    color: #c4c1d4;
    margin-top: 8px;
    letter-spacing: 0.3px;
    padding-top: 8px;
    border-top: 1.5px solid rgba(0, 0, 0, 0.05);
  }

  /* ── Search pin marker ────────────────────────────────────────── */
  .hm-pin {
    width: 32px;
    height: 42px;
    position: relative;
    filter: drop-shadow(0 4px 10px rgba(108,99,255,0.55));
    animation: pin-drop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes pin-drop {
    from { transform: translateY(-14px) scale(0.7); opacity: 0; }
    to   { transform: translateY(0)     scale(1);   opacity: 1; }
  }
  .hm-pin::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 42'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%236c63ff'/%3E%3Cstop offset='100%25' stop-color='%23f72585'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M16 0C9.373 0 4 5.373 4 12c0 9 12 30 12 30S28 21 28 12C28 5.373 22.627 0 16 0z' fill='url(%23g)'/%3E%3Ccircle cx='16' cy='12' r='5' fill='white' opacity='0.95'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center top;
  }
  .hm-pin::after {
    content: '';
    position: absolute;
    bottom: -3px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 5px;
    background: rgba(108,99,255,0.25);
    border-radius: 50%;
    filter: blur(2px);
  }

  /* ── Controls bar ─────────────────────────────────────────────── */
  #hm-bar {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    padding: 8px 12px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1.5px solid rgba(0, 0, 0, 0.07);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.1),
      0 2px 8px rgba(0, 0, 0, 0.06);
    color: #1a1a2e;
    font-family: 'Nunito', system-ui, sans-serif;
    font-size: 13px;
    gap: 10px;
  }

  #hm-timing {
    font-family: 'Nunito', sans-serif;
    font-size: 12px;
    font-weight: 800;
    color: #2ec4b6;
    min-width: 56px;
    text-align: right;
  }

  /* ── Segmented control ─────────────────────────────────────────── */
  #hm-seg {
    display: flex;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 14px;
    padding: 3px;
    gap: 2px;
  }
  .hm-seg-btn {
    background: transparent;
    border: none;
    color: #9a8c98;
    font-family: 'Nunito', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 800;
    padding: 5px 14px;
    border-radius: 11px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    user-select: none;
    white-space: nowrap;
    letter-spacing: 0.1px;
  }
  .hm-seg-btn:hover {
    color: #6c63ff;
    background: rgba(108, 99, 255, 0.08);
  }
  .hm-seg-btn.active {
    background: #6c63ff;
    color: #ffffff;
    box-shadow: 0 2px 12px rgba(108, 99, 255, 0.45);
  }

  /* City loading indicator */
  #hm-city-loading {
    font-family: 'Nunito', sans-serif;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2px;
    color: #c77dff;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  /* ── Stats panel ─────────────────────────────────────────────── */
  #hm-stats {
    position: fixed;
    bottom: 36px;
    left: 12px;
    z-index: 999;
    background: rgba(255, 255, 255, 0.92);
    border: 1.5px solid rgba(0, 0, 0, 0.07);
    border-radius: 18px;
    padding: 12px 16px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
    font-family: 'Nunito', sans-serif;
    font-size: 11.5px;
    font-weight: 700;
    line-height: 1.8;
    min-width: 215px;
    pointer-events: none;
  }
  .hm-stat-row {
    display: flex;
    justify-content: space-between;
    gap: 20px;
  }
  .hm-stat-label { color: #c4c1d4; }
  .hm-stat-val   { color: #9a8c98; text-align: right; font-weight: 800; }

  /* Last click — indigo */
  .hm-stat-row:first-child .hm-stat-val { color: #6c63ff; }

  /* Total data — pink */
  .hm-stat-row:nth-child(7) .hm-stat-val { color: #f72585; }

  /* Cities loaded — teal */
  .hm-stat-row:nth-child(8) .hm-stat-val { color: #2ec4b6; }

  /* ── Search card (place + coords) ───────────────────────────── */
  #hm-search {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 1000;
    width: 288px;
    background: rgba(255, 255, 255, 0.97);
    border-radius: 18px;
    border: 1.5px solid rgba(0, 0, 0, 0.07);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    transition: border-color 0.15s, box-shadow 0.15s;
    overflow: visible;
  }
  #hm-search:focus-within {
    border-color: rgba(108, 99, 255, 0.4);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 0 0 3px rgba(108, 99, 255, 0.13);
  }

  /* ── Place search row ── */
  #hm-search-place {
    position: relative;
    display: flex;
    align-items: center;
  }
  .hm-search-icon {
    position: absolute;
    left: 13px;
    width: 15px;
    height: 15px;
    pointer-events: none;
    flex-shrink: 0;
  }
  .hm-search-field {
    width: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-family: 'Nunito', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: #1a1a2e;
    padding: 10px 34px 10px 35px;
  }
  .hm-search-field::placeholder { color: #b8b3cc; font-weight: 600; }
  #hm-search-clear {
    display: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: 8px;
    border: none;
    background: rgba(0,0,0,0.07);
    border-radius: 50%;
    font-size: 10px;
    color: #9a8c98;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  #hm-search-clear:hover { background: rgba(108,99,255,0.12); color: #6c63ff; }

  /* ── Divider between rows ── */
  .hm-search-divider {
    height: 1px;
    background: rgba(0,0,0,0.06);
    margin: 0 12px;
  }

  /* ── Coords row ── */
  #hm-search-coords {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 8px 7px 12px;
    transition: background 0.15s;
  }
  #hm-search-coords.hm-coords-error {
    animation: hm-shake 0.3s ease;
  }
  @keyframes hm-shake {
    0%,100% { transform: translateX(0); }
    25%      { transform: translateX(-4px); }
    75%      { transform: translateX(4px); }
  }
  .hm-coord-label {
    font-family: 'Nunito', sans-serif;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #9a8c98;
    flex-shrink: 0;
    user-select: none;
  }
  .hm-coord-field {
    border: none;
    outline: none;
    background: rgba(0,0,0,0.04);
    border-radius: 8px;
    font-family: 'Nunito', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: #1a1a2e;
    width: 74px;
    padding: 3px 7px;
    text-align: center;
    -moz-appearance: textfield;
    transition: background 0.12s;
  }
  .hm-coord-field::-webkit-outer-spin-button,
  .hm-coord-field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .hm-coord-field::placeholder { color: #c4c1d4; font-weight: 600; }
  .hm-coord-field:focus { background: rgba(108,99,255,0.08); }
  .hm-coord-dot {
    width: 3px; height: 3px;
    border-radius: 50%;
    background: #d4cfe4;
    flex-shrink: 0;
  }
  #hm-coord-btn {
    background: #6c63ff;
    border: none;
    border-radius: 10px;
    color: #fff;
    font-size: 14px;
    font-family: 'Nunito', sans-serif;
    font-weight: 900;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: auto;
    transition: background 0.12s, transform 0.1s;
  }
  #hm-coord-btn:hover  { background: #5a52d5; transform: scale(1.07); }
  #hm-coord-btn:active { transform: scale(0.93); }

  /* ── Suggestions dropdown ── */
  #hm-search-drop {
    display: none;
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: rgba(255, 255, 255, 0.98);
    border-radius: 16px;
    border: 1.5px solid rgba(0, 0, 0, 0.07);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.13), 0 2px 8px rgba(0, 0, 0, 0.06);
    overflow: hidden;
    z-index: 1001;
  }
  .hm-drop-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid rgba(0,0,0,0.04);
  }
  .hm-drop-item:last-child { border-bottom: none; }
  .hm-drop-item:hover, .hm-drop-active { background: rgba(108,99,255,0.07); }
  .hm-drop-icon { font-size: 15px; flex-shrink: 0; width: 20px; text-align: center; }
  .hm-drop-text { display: flex; flex-direction: column; min-width: 0; }
  .hm-drop-main {
    font-family: 'Nunito', sans-serif;
    font-size: 13px; font-weight: 700; color: #1a1a2e;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .hm-drop-sub {
    font-family: 'Nunito', sans-serif;
    font-size: 11px; font-weight: 600; color: #9a8c98;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Hide MapLibre logo */
  .maplibregl-ctrl-logo { display: none !important; }
`;

const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);
