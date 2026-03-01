/**
 * dataLoader.js
 * Async binary data loading + TypedArray parsing.
 * All heavy lifting done here; hot path allocates nothing.
 */

import { DATA_BASE, CITY_RECORD_BYTES, GRID_HEADER_BYTES, GRID_CELL_ENTRY_BYTES } from './constants.js';

// ─── Country color table ────────────────────────────────────────────────────

/**
 * @returns {Promise<{colorMap: Uint8Array[/* r,g,b → id *\/], idMap: Map<number,{name,code}>}>}
 *
 * colorMap: direct index array indexed by (r<<16|g<<8|b) → country id
 * idMap:    country id → {name, code}
 */
export async function loadCountryColors() {
  const resp = await fetch(DATA_BASE + 'country_colors.json');
  const raw  = await resp.json();

  // Build a flat 16M-entry Uint16Array for O(1) RGB→ID lookup.
  // We only need ~200 countries so 99.99% will be zero (ocean).
  // Size: 16777216 * 2 bytes = 32 MB — too large for mobile.
  //
  // Better: use a plain JS object/Map. With only ~200 entries, property
  // lookup via a packed key (r<<16|g<<8|b) in a Uint32Array of 200 entries
  // is plenty fast (same speed as an object literal for hot code).
  //
  // We store: packed_rgb → id  (sorted for binary search as fallback)

  const idMap   = new Map();  // id (number) → {name, code}
  // Country count ≤ 256, all packed into single blue channel (max RGB key = 255).
  // Use a compact Int32Array of size 256 for O(1) lookup — only 1 KB.
  // Fall back to a JS Map if somehow IDs exceed single channel.
  let maxRGB = 0;
  const rgbEntries = [];

  for (const [idStr, info] of Object.entries(raw)) {
    const id  = parseInt(idStr, 10);
    const [r, g, b] = info.color;
    const rgb = (r << 16) | (g << 8) | b;
    idMap.set(id, { name: info.name, code: info.code });
    rgbEntries.push({ rgb, id });
    if (rgb > maxRGB) maxRGB = rgb;
  }

  // Compact lookup array (maxRGB + 1 entries, typically 243 for 242 countries)
  let fastLookup;
  try {
    const arr = new Int32Array(maxRGB + 1).fill(-1);
    for (const { rgb, id } of rgbEntries) arr[rgb] = id;
    fastLookup = arr;
  } catch (_) {
    fastLookup = new Map(rgbEntries.map(e => [e.rgb, e.id]));
  }

  function lookupRGB(r, g, b) {
    const rgb = (r << 16) | (g << 8) | b;
    if (fastLookup instanceof Int32Array) {
      return rgb < fastLookup.length ? fastLookup[rgb] : -1;
    }
    return fastLookup.get(rgb) ?? -1;
  }

  return { lookupRGB, idMap };
}

// ─── City binary data ───────────────────────────────────────────────────────

export async function loadCityData() {
  const [citiesRes, gridRes, namesRes, metaResp, ccResp, geoRes] = await Promise.all([
    fetch(DATA_BASE + 'cities.bin'),
    fetch(DATA_BASE + 'city_grid.bin'),
    fetch(DATA_BASE + 'city_names.bin'),
    fetch(DATA_BASE + 'metadata.json').then(r => r.json()),
    fetch(DATA_BASE + 'cc_codes.json').then(r => r.json()),
    fetch(DATA_BASE + 'countries_visible.geojson'),
  ]);

  const [citiesBuf, gridBuf, namesBuf, geoText] = await Promise.all([
    citiesRes.arrayBuffer(),
    gridRes.arrayBuffer(),
    namesRes.arrayBuffer(),
    geoRes.text(),
  ]);

  const rawSizes = {
    cities: citiesBuf.byteLength,
    grid:   gridBuf.byteLength,
    names:  namesBuf.byteLength,
    geo:    geoText.length,   // approximate (UTF-8 chars ≈ bytes for ASCII-heavy JSON)
  };

  const meta = metaResp;

  // ── Cities arrays ──
  const cityView      = new DataView(citiesBuf);
  const numCities     = meta.numCities;

  // Pre-extract into typed arrays for cache-friendly access
  const cityLats = new Float32Array(numCities);
  const cityLngs = new Float32Array(numCities);
  const cityPops = new Uint32Array(numCities);
  const cityNameOffsets = new Uint32Array(numCities);
  const cityCCIdx = new Uint16Array(numCities);

  const REC = CITY_RECORD_BYTES;  // 20
  for (let i = 0; i < numCities; i++) {
    const base = i * REC;
    cityLats[i]        = cityView.getFloat32(base,     true);
    cityLngs[i]        = cityView.getFloat32(base + 4, true);
    cityPops[i]        = cityView.getUint32(base + 8,  true);
    cityNameOffsets[i] = cityView.getUint32(base + 12, true);
    cityCCIdx[i]       = cityView.getUint16(base + 16, true);
  }

  // ── Grid ──
  const gridView   = new DataView(gridBuf);
  const numCells   = gridView.getUint32(0,  true);
  const totalRefs  = gridView.getUint32(4,  true);
  const cols       = gridView.getUint32(8,  true);
  const rows       = gridView.getUint32(12, true);
  const cellDeg    = gridView.getFloat32(16, true);

  // Cell table starts at byte 20
  // Each entry: uint32 key, uint32 offset  (8 bytes)
  const CELL_TABLE_START = GRID_HEADER_BYTES;  // 20
  const cellKeys    = new Uint32Array(numCells);
  const cellOffsets = new Uint32Array(numCells + 1);  // +1 for sentinel

  for (let i = 0; i <= numCells; i++) {
    const base = CELL_TABLE_START + i * GRID_CELL_ENTRY_BYTES;
    if (i < numCells) {
      cellKeys[i]    = gridView.getUint32(base,     true);
      cellOffsets[i] = gridView.getUint32(base + 4, true);
    } else {
      // Sentinel entry (key=0xFFFFFFFF, offset=totalRefs)
      cellOffsets[i] = gridView.getUint32(base + 4, true);
    }
  }

  // City refs start after cell table + sentinel
  const REFS_START = CELL_TABLE_START + (numCells + 1) * GRID_CELL_ENTRY_BYTES;
  const cityRefs = new Uint32Array(gridBuf, REFS_START, totalRefs);

  // ── Build HashMap for O(1) cell lookup ──
  // cellMap: cellKey → { start, end } into cityRefs
  const cellMap = new Map();
  for (let i = 0; i < numCells; i++) {
    cellMap.set(cellKeys[i], { start: cellOffsets[i], end: cellOffsets[i + 1] });
  }

  // ── Name decoder ──
  const namesView = new DataView(namesBuf);
  const namesBytes = new Uint8Array(namesBuf);
  const textDecoder = new TextDecoder('utf-8');

  function getCityName(cityIdx) {
    const offset = cityNameOffsets[cityIdx];
    const len = namesView.getUint16(offset, true);
    return textDecoder.decode(namesBytes.subarray(offset + 2, offset + 2 + len));
  }

  return {
    cityLats, cityLngs, cityPops, cityCCIdx, getCityName,
    numCities,
    cellMap, cellDeg, cols, rows,
    cityRefs,
    ccCodes: ccResp,
    _rawSizes: rawSizes,
  };
}
