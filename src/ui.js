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

    // ── Search bar (top-left) ──
    const search = document.createElement('div');
    search.id = 'hm-search';
    search.innerHTML = `
      <span class="hm-search-label">Lat</span>
      <input id="hm-search-lat" class="hm-search-field" type="number"
             step="any" min="-90" max="90"
             autocomplete="off" placeholder="0.0000" />
      <span class="hm-search-sep"></span>
      <span class="hm-search-label">Lng</span>
      <input id="hm-search-lng" class="hm-search-field" type="number"
             step="any" min="-180" max="180"
             autocomplete="off" placeholder="0.0000" />
      <button id="hm-search-btn" title="Go">↵</button>
    `;
    document.body.appendChild(search);
    this._searchEl = search;

    const latInput = search.querySelector('#hm-search-lat');
    const lngInput = search.querySelector('#hm-search-lng');
    const btn      = search.querySelector('#hm-search-btn');

    const fire = () => {
      const lat = parseFloat(latInput.value);
      const lng = parseFloat(lngInput.value);
      const valid = !isNaN(lat) && !isNaN(lng)
                 && lat >= -90  && lat <= 90
                 && lng >= -180 && lng <= 180;
      if (!valid) {
        search.classList.add('error');
        setTimeout(() => search.classList.remove('error'), 400);
        // Focus whichever field is empty / out of range
        if (isNaN(lat) || lat < -90 || lat > 90) latInput.focus();
        else lngInput.focus();
        return;
      }
      latInput.blur(); lngInput.blur();
      if (this._onSearch) this._onSearch({ lat, lng });
    };

    // Enter from either field fires
    latInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); lngInput.focus(); lngInput.select(); }
    });
    lngInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); fire(); }
    });
    btn.addEventListener('click', fire);

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

  /* ── Search bar ──────────────────────────────────────────────── */
  #hm-search {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 999;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    padding: 7px 8px 7px 14px;
    border: 1.5px solid rgba(0, 0, 0, 0.07);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  #hm-search:focus-within {
    border-color: rgba(108, 99, 255, 0.45);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 0 0 3px rgba(108, 99, 255, 0.14);
  }
  #hm-search.error {
    border-color: rgba(247, 37, 133, 0.5);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 0 0 3px rgba(247, 37, 133, 0.12);
    animation: hm-shake 0.3s ease;
  }
  @keyframes hm-shake {
    0%, 100% { transform: translateX(0); }
    25%       { transform: translateX(-5px); }
    75%       { transform: translateX(5px); }
  }

  /* "Lat" / "Lng" labels */
  .hm-search-label {
    font-family: 'Nunito', sans-serif;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: #9a8c98;
    flex-shrink: 0;
    user-select: none;
  }

  /* Number input fields */
  .hm-search-field {
    border: none;
    outline: none;
    background: rgba(0, 0, 0, 0.04);
    border-radius: 9px;
    font-family: 'Nunito', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: #1a1a2e;
    width: 80px;
    padding: 4px 8px;
    text-align: center;
    transition: background 0.15s ease;
    /* hide browser number spinners */
    -moz-appearance: textfield;
  }
  .hm-search-field::-webkit-outer-spin-button,
  .hm-search-field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .hm-search-field::placeholder { color: #c4c1d4; font-weight: 600; }
  .hm-search-field:focus { background: rgba(108, 99, 255, 0.07); }

  /* divider dot between the two fields */
  .hm-search-sep {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #d4cfe4;
    flex-shrink: 0;
  }

  #hm-search-btn {
    background: #6c63ff;
    border: none;
    border-radius: 12px;
    color: #fff;
    font-size: 15px;
    font-family: 'Nunito', sans-serif;
    font-weight: 900;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 2px;
    transition: background 0.15s ease, transform 0.1s ease;
    line-height: 1;
  }
  #hm-search-btn:hover  { background: #5a52d5; transform: scale(1.06); }
  #hm-search-btn:active { transform: scale(0.94); }

  /* Hide MapLibre logo */
  .maplibregl-ctrl-logo { display: none !important; }
`;

const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);
