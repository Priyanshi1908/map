# ⚡ HyperMap — The Fastest Interactive World Map

## Mission

Click anywhere on Earth → instantly know the **country** and **nearest city**.
Win on every axis: speed, precision, memory, smoothness, mobile stability.

---

## Core Philosophy

1. **Move all heavy computation offline.** Runtime does near-zero work.
2. **Use the GPU where it's superior.** Don't re-solve problems the GPU already solves.
3. **Use the right data structure for each problem.** Countries and cities are different problems — treat them differently.
4. **Optimize the whole pipeline.** A 0.001ms lookup means nothing if your frame drops or your tooltip causes a reflow.
5. **Mobile is not an afterthought.** If it crashes on a 3-year-old iPhone, you lose.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                   OFFLINE BUILD PIPELINE                     │
│                     (Python, runs once)                      │
│                                                              │
│  Natural Earth GeoJSON ──▶ Country ID color map              │
│  GeoNames cities15000 ──▶ Spatial hash grid (binary)         │
│                      ──▶ City metadata (binary)              │
│                      ──▶ metadata.json                       │
└──────────────────────────────────────────────────────────────┘
                            │
                     Static .bin files
                     served via CDN
                            │
┌──────────────────────────────────────────────────────────────┐
│                    RUNTIME (Browser)                         │
│                                                              │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │  MapLibre    │    │ Hidden       │    │ Spatial Hash   │  │
│  │  GL JS       │    │ Framebuffer  │    │ Grid (binary)  │  │
│  │  (visible)   │    │ (GPU picking)│    │ (TypedArrays)  │  │
│  └──────┬──────┘    └──────┬───────┘    └───────┬────────┘  │
│         │                  │                     │           │
│         ▼                  ▼                     ▼           │
│       Click ──▶ lat/lng + pixel read ──▶ country + city     │
│                                                  │           │
│                                          ┌───────▼────────┐ │
│                                          │  Tooltip / UI  │ │
│                                          │  (single DOM   │ │
│                                          │   element)     │ │
│                                          └────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## Part 1: Country Detection

### Method: GPU Color Picking

This is the best approach for country detection. Period.

#### Why

| Factor                   | Grid Raster        | Point-in-Polygon   | **GPU Color Picking**  |
| ------------------------ | ------------------ | ------------------ | ---------------------- |
| Border precision         | Resolution-limited | Exact but slow     | **Pixel-perfect**      |
| Small islands            | Often missed       | Works              | **Automatic**          |
| Zoom independence        | Fixed resolution   | N/A                | **Works at any zoom**  |
| Memory cost              | 6-50 MB            | Polygon data       | **~0 (color table)**   |
| Runtime computation      | Array index        | Ray casting        | **1 pixel read**       |
| Implementation elegance  | Brute force        | Complex            | **Leverages GPU**      |

#### How It Works

1. MapLibre already renders country polygons on the GPU.
2. Maintain a **second hidden WebGL framebuffer** (offscreen canvas).
3. In the hidden framebuffer, render every country filled with a **unique solid RGB color**.
   - Country 0 → `rgb(0, 0, 1)` ... Country 199 → `rgb(0, 0, 200)`
   - 24-bit color = 16.7 million unique IDs (we need ~200)
4. On click:
   - Get the pixel coordinate on the hidden framebuffer.
   - `gl.readPixels()` → read 1 pixel → RGB value.
   - Map RGB → country ID via a lookup table.
   - Done.

#### Performance

- **Lookup time:** ~0.1–0.3ms (single GPU pixel read)
- **Memory:** Negligible (just a 200-entry color→name mapping)
- **Precision:** Pixel-perfect at any zoom level
- **Edge cases:** Handles enclaves, exclaves, tiny islands, disputed borders — anything the renderer draws

#### Color Mapping Table (Built Offline)

```json
{
  "1": { "name": "Afghanistan", "code": "AF", "color": [0, 0, 1] },
  "2": { "name": "Albania", "code": "AL", "color": [0, 0, 2] }
}
```

#### Implementation Notes

- The hidden framebuffer must stay in sync with the visible map's viewport (pan, zoom, rotation).
- Use MapLibre's `map.on('moveend')` and `map.on('render')` to keep them synced.
- Render the hidden layer with `antialias: false` — antialiased edges blend colors and corrupt the ID.
- Use a 1:1 pixel ratio for the hidden canvas (no need for retina resolution).
- The hidden canvas can be smaller than the visible one (e.g., half resolution) to save GPU memory. Precision is still excellent.

---

## Part 2: City Detection

### Method: Spatial Hash Grid with Pre-Sorted Cells

This combines the best properties: low memory, exact coordinates, fast lookup, mobile-safe.

#### Why Not Other Approaches

| Approach           | Speed    | Memory   | Precision | Mobile Safe | Verdict         |
| ------------------ | -------- | -------- | --------- | ----------- | --------------- |
| Full raster grid   | O(1)     | 40-60 MB | ~5-11km   | ❌ Risky    | Too much memory |
| KD-tree            | O(log n) | ~2 MB    | Exact     | ✅          | Good, not best  |
| Brute force        | O(n)     | Tiny     | Exact     | ✅          | Too slow        |
| **Spatial hash**   | **~O(1)**| **3-5 MB**| **Exact**| **✅**      | **Best balance**|

#### Grid Design

**Cell size: 0.25° × 0.25°** (~28km at equator)

This means:
- Grid dimensions: 1440 × 720 = 1,036,800 possible cells
- But we **only store cells that contain cities** (sparse structure)
- Typical fill: ~15,000–25,000 non-empty cells out of 1M+
- Average cities per occupied cell: 1–3 (most cells have very few)

#### Data Structures (All Binary TypedArrays)

```
cityLatitudes:    Float32Array[N]     // N = number of cities (~26,000)
cityLongitudes:   Float32Array[N]
cityNames:        Uint32Array[N]      // offset into string table
cityPopulations:  Uint32Array[N]
cityCountryCodes: Uint16Array[N]

gridCellOffsets:  Uint32Array[M+1]    // M = number of non-empty cells
gridCellIndices:  Uint16Array[total]  // city indices packed contiguously
gridCellKeys:     Uint32Array[M]      // cell hash keys for lookup
```

**Cities within each cell are pre-sorted by population (descending).**
Largest city checked first = most likely correct answer found immediately.

#### Lookup Algorithm

```
function findNearestCity(lat, lng):
    // Step 1: Compute cell key
    col = floor((lng + 180) / 0.25)         // integer math
    row = floor((90 - lat) / 0.25)          // integer math
    key = row * 1440 + col                  // integer math

    // Step 2: Search this cell + 8 neighbors (3x3 block)
    bestDist = Infinity
    bestCity = -1

    for dr in [-1, 0, 1]:
      for dc in [-1, 0, 1]:
        neighborKey = (row + dr) * 1440 + (col + dc)
        cities = getCitiesInCell(neighborKey)    // binary search on gridCellKeys

        for cityIdx of cities:
          dlat = cityLatitudes[cityIdx] - lat
          dlng = cityLongitudes[cityIdx] - lng
          dist = dlat * dlat + dlng * dlng       // SQUARED distance — no sqrt needed
          if dist < bestDist:
            bestDist = dist
            bestCity = cityIdx

    return bestCity
```

#### Why This Is Fast

- **3×3 neighbor search** guarantees we never miss the nearest city, even at cell borders.
- **Squared distance** avoids expensive `Math.sqrt()`. We're comparing, not measuring.
- **Pre-sorted by population** means for the common case (clicking near a big city), the first comparison often wins and branch prediction kicks in.
- **Average comparisons per lookup: 5–20 cities.** That's 5–20 multiplications and comparisons. Trivial.
- **All data in contiguous TypedArrays.** CPU cache-line friendly. No pointer chasing, no object headers, no GC.

#### Performance

- **Lookup time:** ~0.01–0.1ms
- **Memory:** ~3–5 MB total
- **Precision:** Exact (real lat/lng coordinates, not grid-quantized)
- **Mobile safe:** No large contiguous allocations

#### Cell Lookup Optimization

The `getCitiesInCell(key)` function uses **binary search** on the sorted `gridCellKeys` array to find the cell, then reads the offset range from `gridCellOffsets`. This is O(log M) where M ≈ 20,000 cells — about 15 comparisons.

**Further optimization:** Build a **HashMap at load time** from the binary data for true O(1) cell lookup. Binary search on 20K entries is ~0.002ms so this is optional, but for competition-grade speed, the HashMap wins.

---

## Part 3: Data Pipeline (Offline Build)

### Language: Python

Dependencies: `shapely`, `geopandas`, `numpy`, `struct`

### Data Sources

| Data            | Source                          | Size     |
| --------------- | ------------------------------- | -------- |
| Country borders | Natural Earth 50m admin-0       | ~4 MB    |
| City database   | GeoNames `cities15000.txt`      | ~2 MB    |

### Build Steps

```
1. COUNTRY DATA
   ├── Load Natural Earth GeoJSON
   ├── Assign each country a unique integer ID (1–255)
   ├── Assign each country a unique RGB color
   ├── Generate country_colors.json:
   │     { id → { name, code, rgb } }
   ├── Generate simplified GeoJSON for the hidden framebuffer
   │     (only fill color matters, no labels, no borders)
   └── Output: country_colors.json, countries_picking.geojson

2. CITY DATA
   ├── Load cities15000.txt
   ├── Parse: name, lat, lng, country_code, population
   ├── Filter: remove cities below population threshold (optional)
   ├── Sort cities into spatial grid cells (0.25° resolution)
   ├── Within each cell, sort by population descending
   ├── Pack into binary format:
   │     ├── cities.bin (lat, lng, name_offset, population, country)
   │     ├── city_grid.bin (cell keys, offsets, city indices)
   │     └── city_names.bin (packed string table)
   └── Output: cities.bin, city_grid.bin, city_names.bin, metadata.json
```

### Build Script Output

```
build/output/
├── country_colors.json        (~5 KB)
├── countries_picking.geojson  (~500 KB, simplified for hidden canvas)
├── cities.bin                 (~800 KB)
├── city_grid.bin              (~400 KB)
├── city_names.bin             (~600 KB)
└── metadata.json              (~2 KB)

Total: ~2.3 MB uncompressed, ~800 KB–1.2 MB with Brotli
```

---

## Part 4: Runtime Stack

### Renderer: MapLibre GL JS

- WebGL-accelerated vector tile rendering
- Smooth 60fps pan/zoom on desktop and mobile
- Built-in GeoJSON layer support for country highlighting
- Free and open source (no API key needed for self-hosted tiles)
- Tile source: free vector tiles from MapTiler, Protomaps, or similar

### Country Highlighting

Use MapLibre's `setFeatureState()` to change a country's fill color on click.

This is a **GPU-side operation** — no geometry recalculation, no layer re-render, no DOM change. Just a uniform update in the shader. Instant.

```js
map.setFeatureState(
  { source: 'countries', id: countryId },
  { highlighted: true }
);
```

The style layer uses a `case` expression to apply highlight color based on feature state.

### Tooltip

- **Single DOM element**, created once, never destroyed.
- Positioned with `transform: translate(x, y)` — GPU-composited, no layout thrash.
- Updated via `textContent` (not `innerHTML` — avoids HTML parser overhead).
- Visibility toggled via `opacity` or `visibility` (not `display: none` which triggers layout recalc).

### No Framework

Vanilla JS. No React, no Vue, no Svelte. The entire runtime is:
- MapLibre (renderer)
- ~200 lines of JS (lookup, UI, glue)

Zero framework overhead. Zero virtual DOM diffing. Zero unnecessary abstractions.

---

## Part 5: Performance Optimizations

### Loading

| Technique                        | Impact                                  |
| -------------------------------- | --------------------------------------- |
| Brotli compression on all .bin   | 40-60% smaller than gzip                |
| Lazy-load city data              | Country mode works instantly            |
| Predictive load on toggle hover  | City data starts loading before switch  |
| Service Worker caching           | Instant on repeat visits                |
| Stream-parse binary files        | UI responsive during load               |

### Runtime

| Technique                        | Impact                                  |
| -------------------------------- | --------------------------------------- |
| No `Math.sqrt()` in distance     | Avoid expensive FPU operation           |
| Pre-sorted cells by population   | Most likely answer found first          |
| TypedArray everywhere            | Zero GC pressure, cache-friendly        |
| No object allocation in hot path | No GC pauses                            |
| `requestAnimationFrame` batching | Prevent layout thrashing                |
| Debounce mousemove (not click)   | Smooth hover preview without overload   |

### Memory

| Technique                        | Impact                                  |
| -------------------------------- | --------------------------------------- |
| Sparse grid (only land cells)    | ~95% fewer cells than full raster       |
| Binary packed data               | No JSON parse overhead, no string keys  |
| Shared ArrayBuffer (optional)    | Zero-copy transfer to Web Worker        |
| No duplicate data                | City name stored once in string table   |

### GPU

| Technique                          | Impact                                |
| ---------------------------------- | ------------------------------------- |
| Hidden framebuffer at half res     | 75% less GPU memory for picking       |
| `antialias: false` on pick canvas  | Correct color IDs, faster render      |
| `setFeatureState` for highlights   | Shader-level update, no geometry work |
| 1:1 pixel ratio on pick canvas     | No retina overhead for hidden layer   |

---

## Part 6: Mobile-Specific Strategy

Mobile is where most solutions break. We don't.

| Risk                              | Mitigation                                          |
| --------------------------------- | --------------------------------------------------- |
| Large TypedArray allocation crash | Sparse grid keeps total under 5 MB                  |
| Safari WebGL memory limits        | Half-res pick framebuffer, minimal textures          |
| Touch event jank                  | Use `touchend` not `touchmove` for lookup            |
| Slow CPU                          | Lookup is 5-20 comparisons, trivially fast           |
| High DPI overhead                 | Pick canvas at 1x, visible map at native DPR         |
| Battery drain                     | No continuous computation, only on interaction        |

---

## Part 7: What We DON'T Do (And Why)

| Rejected Approach            | Why                                                       |
| ---------------------------- | --------------------------------------------------------- |
| Web Worker for city lookup   | Message posting overhead (~0.5ms) > lookup itself (~0.05ms). Counterproductive. |
| Full raster grid for cities  | 40-60 MB memory. Crashes mobile Safari. Resolution-limited precision. |
| KD-tree for cities           | Pointer-chasing access pattern. Cache-unfriendly. Slower than spatial hash in practice. |
| React/Vue/Svelte             | Framework overhead for what is ~200 lines of vanilla JS. Unnecessary. |
| GeoJSON point-in-polygon     | CPU-side polygon math when the GPU already has the answer. Wasteful. |
| Voronoi precomputation       | Massive build complexity for marginal gain over spatial hash. |
| `innerHTML` for tooltip      | Triggers HTML parser. `textContent` is 10x faster.         |
| `display: none` toggling     | Triggers layout recalc. `visibility`/`opacity` is composited. |

---

## Part 8: Performance Targets

| Metric              | Target          | How We Achieve It                       |
| ------------------- | --------------- | --------------------------------------- |
| Country lookup      | < 0.3ms         | GPU pixel read                          |
| City lookup         | < 0.1ms         | Spatial hash, squared distance          |
| Frame time          | < 16ms (60fps)  | No main-thread blocking                 |
| Total memory        | < 15 MB         | Sparse binary data, no JSON bloat       |
| Initial load        | < 1.5s          | Brotli, lazy loading, stream parsing    |
| Repeat visit load   | < 0.5s          | Service Worker cache                    |
| Mobile stability    | Zero crashes     | No large allocations, sparse structures |

---

## Part 9: Project Structure

```
hypermap/
├── PLAN.md                          ← this file
│
├── build/                           ← offline pipeline (Python)
│   ├── generate_data.py             ← main build script
│   ├── requirements.txt             ← shapely, geopandas, numpy
│   └── data/
│       ├── ne_50m_admin_0.geojson   ← Natural Earth countries
│       └── cities15000.txt          ← GeoNames cities
│
├── public/
│   ├── data/                        ← built binary files
│   │   ├── country_colors.json
│   │   ├── countries_picking.geojson
│   │   ├── cities.bin
│   │   ├── city_grid.bin
│   │   ├── city_names.bin
│   │   └── metadata.json
│   └── index.html
│
├── src/
│   ├── main.js                      ← entry: map init, event binding, mode toggle
│   ├── countryPicker.js             ← hidden framebuffer setup, pixel read, color→ID
│   ├── cityLookup.js                ← spatial hash grid, nearest city search
│   ├── dataLoader.js                ← async binary loading, TypedArray parsing
│   ├── ui.js                        ← tooltip, toggle switch, timing display
│   └── constants.js                 ← grid resolution, color mappings, config
│
├── package.json
└── vite.config.js
```

---

## Part 10: Execution Plan

| Step | Task                                              | Time       |
| ---- | ------------------------------------------------- | ---------- |
| 1    | Download Natural Earth + GeoNames data            | 10 min     |
| 2    | Write Python build script (city grid + colors)    | 2-3 hours  |
| 3    | Run build, verify binary outputs                  | 15 min     |
| 4    | Scaffold Vite + MapLibre, get map rendering       | 30 min     |
| 5    | Implement GPU color picking for countries         | 2-3 hours  |
| 6    | Implement spatial hash city lookup                | 2-3 hours  |
| 7    | Implement data loader (async binary → TypedArray) | 1 hour     |
| 8    | Build UI (tooltip, toggle, timing display)        | 1 hour     |
| 9    | Mobile testing + optimization                     | 1-2 hours  |
| 10   | Compression, caching, Service Worker              | 1 hour     |
| 11   | Benchmarking, profiling, final polish             | 1-2 hours  |


---

## Why This Wins

We don't win on one trick. We win because **every layer is optimized:**

- **Country detection** uses the GPU — the hardware literally designed for this.
- **City detection** uses a cache-friendly sparse grid with pre-sorted cells and zero allocation.
- **Rendering** is WebGL-native with shader-level highlighting.
- **Data** is binary-packed, Brotli-compressed, lazy-loaded.
- **UI** is a single reused DOM element with GPU-composited positioning.
- **Memory** stays under 15 MB. Mobile doesn't flinch.
- **No framework, no bloat, no unnecessary abstraction.**

Every microsecond matters. But so does every kilobyte, every frame, and every allocation. We optimize the full stack, not just the lookup function.