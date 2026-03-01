// Grid resolution (must match build script)
export const CELL_DEG  = 0.25;
export const COLS      = 1440;  // 360 / 0.25
export const ROWS      = 720;   // 180 / 0.25

// City record layout in cities.bin (20 bytes per city)
export const CITY_RECORD_BYTES = 20;
export const CITY_FIELD_LAT    = 0;   // float32 offset 0
export const CITY_FIELD_LNG    = 4;   // float32 offset 4
export const CITY_FIELD_POP    = 8;   // uint32  offset 8
export const CITY_FIELD_NAMEOFF= 12;  // uint32  offset 12
export const CITY_FIELD_CC     = 16;  // uint16  offset 16

// Grid binary layout
export const GRID_HEADER_BYTES       = 20; // 4 uint32 + 1 float32
export const GRID_CELL_ENTRY_BYTES   = 8;  // uint32 key + uint32 offset

// Data paths (relative to public/)
export const DATA_BASE = '/data/';

// Map style — OpenFreeMap (no API key needed)
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// Highlight color for selected country
export const HIGHLIGHT_COLOR = '#ff6b35';
export const HIGHLIGHT_OPACITY = 0.4;

// Ocean / no-data color sentinel
export const OCEAN_ID = 0;
