/**
 * cityLookup.js — nearest-city search
 *
 * Strategy:
 *   1. Search 3×3 cell block (~75km radius)     — covers dense areas
 *   2. If empty, search 7×7 block (~175km)       — covers sparse areas
 *   3. If still empty, linear scan all cities    — guaranteed result
 *      (3095 comparisons, ~0.05ms — trivial)
 */

import { CELL_DEG, COLS, ROWS } from './constants.js';

export function findNearestCity(lat, lng, cityData) {
  const { cityLats, cityLngs, cityPops, cityCCIdx, getCityName, cellMap, cityRefs, ccCodes } = cityData;
  const cols    = cityData.cols    ?? COLS;
  const rows    = cityData.rows    ?? ROWS;
  const cellDeg = cityData.cellDeg ?? CELL_DEG;

  const col0 = Math.max(0, Math.min(cols - 1, ((lng + 180.0) / cellDeg) | 0));
  const row0 = Math.max(0, Math.min(rows - 1, ((90.0 - lat)  / cellDeg) | 0));

  let bestIdx   = -1;
  let bestDist2 = Infinity;

  // ── Pass 1: 3×3, Pass 2: extend to 7×7 ring ────────────────────────────
  for (const radius of [1, 3]) {
    for (let dr = -radius; dr <= radius; dr++) {
      const row = row0 + dr;
      if (row < 0 || row >= rows) continue;
      for (let dc = -radius; dc <= radius; dc++) {
        if (radius === 3 && Math.abs(dr) <= 1 && Math.abs(dc) <= 1) continue; // skip already-searched inner ring
        const col = col0 + dc;
        if (col < 0 || col >= cols) continue;
        const cell = cellMap.get((row * cols + col) >>> 0);
        if (!cell) continue;
        for (let r = cell.start; r < cell.end; r++) {
          const i = cityRefs[r];
          const dlat = cityLats[i] - lat;
          const dlng = cityLngs[i] - lng;
          const d2   = dlat * dlat + dlng * dlng;
          if (d2 < bestDist2) { bestDist2 = d2; bestIdx = i; }
        }
      }
    }
    if (bestIdx !== -1) break;
  }

  // ── Pass 3: global linear scan — always finds something ─────────────────
  if (bestIdx === -1) {
    const n = cityData.numCities;
    for (let i = 0; i < n; i++) {
      const dlat = cityLats[i] - lat;
      const dlng = cityLngs[i] - lng;
      const d2   = dlat * dlat + dlng * dlng;
      if (d2 < bestDist2) { bestDist2 = d2; bestIdx = i; }
    }
  }

  if (bestIdx === -1) return null;

  return {
    idx:    bestIdx,
    name:   getCityName(bestIdx),
    lat:    cityLats[bestIdx],
    lng:    cityLngs[bestIdx],
    pop:    cityPops[bestIdx],
    cc:     ccCodes[cityCCIdx[bestIdx]] ?? '??',
    distKm: haversine(lat, lng, cityLats[bestIdx], cityLngs[bestIdx]),
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
