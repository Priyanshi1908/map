/**
 * countryPicker.js
 *
 * Country detection via MapLibre's queryRenderedFeatures().
 *
 * Previous approach (second hidden MapLibre map + gl.readPixels) was
 * fundamentally broken: the pick map can never stay pixel-perfectly in
 * sync with the main map after zoom/pan because rendering is async.
 *
 * queryRenderedFeatures() is MapLibre's native, always-correct point
 * query — it works on already-rendered tile data, returns instantly,
 * and is correct at any zoom level.  Typical cost: ~0.5–3ms.
 */

export class CountryPicker {
  constructor() {
    this._ready  = false;
    this._map    = null;
  }

  /**
   * @param {import('maplibre-gl').Map} map
   * @param {function} _lookupRGB  (unused — kept for API compat)
   * @param {Map}      _idMap      (unused — data comes from GeoJSON props)
   */
  async init(map, _lookupRGB, _idMap) {
    this._map   = map;
    this._ready = true;
    // Nothing else to do — no second map, no extra canvas, no sync issues.
  }

  /**
   * Query what country is at pixel (x, y) on the main map canvas.
   * @returns {{ id:number, name:string, code:string } | null}
   */
  pick(x, y) {
    if (!this._ready || !this._map) return null;

    const features = this._map.queryRenderedFeatures([x, y], {
      layers: ['country-hit'],
    });

    if (!features.length) return null;

    const props = features[0].properties;
    if (!props?.name) return null;

    return {
      id:   props.id   ?? 0,
      name: props.name ?? '',
      code: props.code ?? '',
    };
  }
}
