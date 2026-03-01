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
    this._mode        = 'country'; // 'country' | 'city'
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
    this._timingEl.textContent = `${ms.toFixed(2)}ms`;
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

    // Mode toggle
    const toggle = document.createElement('label');
    toggle.id = 'hm-toggle';
    toggle.innerHTML = `
      <span class="hm-label">Country</span>
      <div class="hm-switch">
        <input type="checkbox" id="hm-mode-cb">
        <span class="hm-slider"></span>
      </div>
      <span class="hm-label">City</span>
    `;
    bar.appendChild(toggle);
    this._modeToggle = toggle;

    const cb = document.getElementById('hm-mode-cb');

    // Predictive load: start fetching city data on hover before toggle
    toggle.addEventListener('mouseenter', () => {
      if (this._onModeChange) this._onModeChange('prefetch');
    }, { once: true });

    cb.addEventListener('change', () => {
      this._mode = cb.checked ? 'city' : 'country';
      if (this._onModeChange) this._onModeChange(this._mode);
    });

    // City loading spinner
    const loading = document.createElement('div');
    loading.id = 'hm-city-loading';
    loading.textContent = 'Loading cities…';
    loading.style.opacity = '0';
    bar.appendChild(loading);
    this._cityLoading = loading;
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
  #hm-tooltip .hm-country { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
  #hm-tooltip .hm-ocean   { color: #6b7280 !important; }
  #hm-tooltip .hm-code    { font-size: 11px; color: #6b7280; margin-top: 1px; }
  #hm-tooltip .hm-city    { font-size: 13px; color: #a0cfff; margin-top: 4px; }
  #hm-tooltip .hm-cc      { color: #6b7280; }
  #hm-tooltip .hm-dist    { font-size: 11px; color: #888; margin-top: 2px; }
  #hm-tooltip .hm-coords  { font-size: 10px; color: #555; margin-top: 4px; font-weight: 400; font-family: monospace; }
  #hm-tooltip .hm-flag    { font-size: 22px; margin-bottom: 4px; display: block; }

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

  .hm-label {
    font-size: 12px;
    font-weight: 600;
    color: #ccc;
    user-select: none;
  }

  .hm-switch {
    position: relative;
    width: 36px;
    height: 20px;
  }
  .hm-switch input { display: none; }
  .hm-slider {
    position: absolute;
    inset: 0;
    background: #333;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .hm-slider::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  #hm-mode-cb:checked ~ .hm-slider { background: #3b82f6; }
  #hm-mode-cb:checked ~ .hm-slider::after { transform: translateX(16px); }

  #hm-city-loading {
    font-size: 11px;
    color: #facc15;
    transition: opacity 0.3s;
    pointer-events: none;
  }

  /* Hide MapLibre logo from pick canvas */
  .maplibregl-ctrl-logo { display: none !important; }
`;

const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);
