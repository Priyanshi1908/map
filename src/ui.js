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
    this._mode        = 'country'; // 'country' | 'state' | 'city'
    this._onModeChange = null;

    this._build();
  }

  get mode() { return this._mode; }

  onModeChange(fn) { this._onModeChange = fn; }

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

    // ── Stats panel (bottom-left) ──
    const stats = document.createElement('div');
    stats.id = 'hm-stats';
    stats.innerHTML = `
      <div class="hm-stat-row"><span class="hm-stat-label">Last click</span><span class="hm-stat-val" id="hs-click">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">cities.bin</span><span class="hm-stat-val" id="hs-cities">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">city_grid.bin</span><span class="hm-stat-val" id="hs-grid">—</span></div>
      <div class="hm-stat-row"><span class="hm-stat-label">city_names.bin</span><span class="hm-stat-val" id="hs-names">—</span></div>
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
    if (sizes.cities) set('hs-cities', fmt(sizes.cities));
    if (sizes.grid)   set('hs-grid',   fmt(sizes.grid));
    if (sizes.names)  set('hs-names',  fmt(sizes.names));
    if (sizes.geo)    set('hs-geo',    fmt(sizes.geo));
    // Track running total in dataset attribute
    const panel = this._statsEl;
    if (panel) {
      const prev = JSON.parse(panel.dataset.sizes || '{}');
      const merged = {
        cities: sizes.cities || prev.cities || 0,
        grid:   sizes.grid   || prev.grid   || 0,
        names:  sizes.names  || prev.names  || 0,
        geo:    sizes.geo    || prev.geo    || 0,
      };
      panel.dataset.sizes = JSON.stringify(merged);
      const total = merged.cities + merged.grid + merged.names + merged.geo;
      set('hs-total', fmt(total));
    }
    if (sizes.numCities) set('hs-ncities', sizes.numCities.toLocaleString() + ' cities');
  }
}

// ── Style injection ──────────────────────────────────────────────────────────

const css = `
  #hm-tooltip {
    background: rgba(10,10,15,0.92);
    color: #fff;
    border-radius: 8px;
    padding: 10px 14px;
    font: 600 13px/1.4 'Inter', system-ui, sans-serif;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3);
    max-width: 240px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.08);
  }
  #hm-tooltip .hm-country     { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
  #hm-tooltip .hm-ocean       { color: #6b7280 !important; }
  #hm-tooltip .hm-code        { font-size: 11px; color: #6b7280; margin-top: 1px; }
  #hm-tooltip .hm-city        { font-size: 13px; color: #a0cfff; margin-top: 4px; }
  #hm-tooltip .hm-city-name   { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 3px; }
  #hm-tooltip .hm-country-sub { font-size: 12px; color: #9ca3af; margin-bottom: 3px; }
  #hm-tooltip .hm-state-name  { font-size: 16px; font-weight: 700; color: #c4b5fd; margin-bottom: 3px; }
  #hm-tooltip .hm-cc          { color: #6b7280; }
  #hm-tooltip .hm-dist        { font-size: 11px; color: #888; margin-top: 2px; }
  #hm-tooltip .hm-coords      { font-size: 10px; color: #555; margin-top: 4px; font-weight: 400; font-family: monospace; }
  #hm-tooltip .hm-flag        { font-size: 22px; margin-bottom: 4px; display: block; }

  #hm-bar {
    background: rgba(10,10,15,0.85);
    border-radius: 10px;
    padding: 8px 12px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    color: #fff;
    font: 13px/1 'Inter', system-ui, sans-serif;
  }

  #hm-timing {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: #4ade80;
    min-width: 56px;
    text-align: right;
  }

  /* 3-way segmented control */
  #hm-seg {
    display: flex;
    background: rgba(255,255,255,0.06);
    border-radius: 7px;
    padding: 2px;
    gap: 2px;
  }
  .hm-seg-btn {
    background: transparent;
    border: none;
    color: #9ca3af;
    font: 600 12px/1 'Inter', system-ui, sans-serif;
    padding: 5px 11px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    user-select: none;
    white-space: nowrap;
  }
  .hm-seg-btn:hover  { color: #e5e7eb; background: rgba(255,255,255,0.08); }
  .hm-seg-btn.active { background: #3b82f6; color: #fff; }

  #hm-city-loading {
    font-size: 11px;
    color: #facc15;
    transition: opacity 0.3s;
    pointer-events: none;
  }

  /* Hide MapLibre logo from pick canvas */
  .maplibregl-ctrl-logo { display: none !important; }

  /* Stats panel */
  #hm-stats {
    position: fixed;
    bottom: 36px;
    left: 12px;
    z-index: 999;
    background: rgba(10,10,15,0.82);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    padding: 8px 12px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    font: 11px/1.6 'JetBrains Mono','Fira Code',monospace;
    color: #9ca3af;
    min-width: 200px;
    pointer-events: none;
  }
  .hm-stat-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .hm-stat-label { color: #6b7280; }
  .hm-stat-val   { color: #4ade80; text-align: right; }
  .hm-stat-row:first-child .hm-stat-val { color: #60a5fa; }
  .hm-stat-row:nth-child(6) .hm-stat-val { color: #f472b6; font-weight: 700; }
`;

const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);
