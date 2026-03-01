/**
 * cityLookup.js
 * Nearest-city search using spatial hash grid.
 * Hot path: zero allocations, zero sqrt, 5-20 comparisons.
 */

import { CELL_DEG, COLS, ROWS } from './constants.js';

/**
 * Find the nearest city to (lat, lng).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} cityData  - from dataLoader.loadCityData()
 * @returns {{ name: string, lat: number, lng: number, pop: number, cc: string, distKm: number }|null}
 */
export function findNearestCity(lat, lng, cityData) {
  const {
    cityLats, cityLngs, cityPops, cityCCIdx, getCityName,
    cellMap, cityRefs, ccCodes,
    cols = COLS, rows = ROWS, cellDeg = CELL_DEG,
  } = cityData;

  // ── Step 1: compute base cell ──
  const col0 = Math.max(0, Math.min(cols - 1, ((lng + 180.0) / cellDeg) | 0));
  const row0 = Math.max(0, Math.min(rows - 1, ((90.0 - lat)  / cellDeg) | 0));

  let bestDist2 = Infinity;
  let bestIdx   = -1;

  // ── Step 2: search 3×3 neighbor block ──
  for (let dr = -1; dr <= 1; dr++) {
    const row = row0 + dr;
    if (row < 0 || row >= rows) continue;

    for (let dc = -1; dc <= 1; dc++) {
      const col = col0 + dc;
      if (col < 0 || col >= cols) continue;

      const key  = row * cols + col;
      const cell = cellMap.get(key);
      if (!cell) continue;

      // Cities in this cell are pre-sorted by population desc
      for (let r = cell.start; r < cell.end; r++) {
        const i    = cityRefs[r];
        const dlat = cityLats[i] - lat;
        const dlng = cityLngs[i] - lng;
        const d2   = dlat * dlat + dlng * dlng;  // squared — no sqrt!
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestIdx   = i;
        }
      }
    }
  }

  if (bestIdx === -1) return null;

  // Haversine distance for display only (not in hot path)
  const distKm = haversine(lat, lng, cityLats[bestIdx], cityLngs[bestIdx]);

  return {
    name:   getCityName(bestIdx),
    lat:    cityLats[bestIdx],
    lng:    cityLngs[bestIdx],
    pop:    cityPops[bestIdx],
    cc:     ccCodes[cityCCIdx[bestIdx]] ?? '??',
    distKm,
  };
}

// Haversine (only called for display, not in hot path)
function haversine(lat1, lon1, lat2, lon2) {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dG = ((lon2 - lon1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
