import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// A Strava-style heatmap of the rides: the more often you rode a street, the hotter it is drawn.
//
// 1. Every ride is stroked as one path with additive blending, adding 1 to the red channel of the pixels it covers.
//    Afterwards the red channel of a pixel is the number of rides that went through it (up to 255).
// 2. That count is compared with how busy your busiest streets are, so a street ridden once stays pale next to one
//    ridden fifty times, whether you have 5 rides or 500.
// 3. The result is coloured with a "hot" palette: pale yellow, orange, red, deep red.

export const LINE_WIDTH = 4;
export const MIN_PEAK = 8; // with little data the busiest street is not shown as "hot" until it was ridden this often
export const MIN_LEVEL = 40; // even a single pass stays visible
export const PEAK_PERCENTILE = 0.98; // one hot spot (say, the street everybody starts on) should not wash out the rest
export const GAMMA = 0.8; // lifts the low counts a little

// level (0..255) -> [r, g, b, a]
export const STOPS = [
  [0, [255, 235, 160, 0]],
  [20, [255, 235, 160, 90]],
  [40, [255, 214, 102, 150]], // ridden once or twice
  [110, [255, 150, 40, 215]], // a few times
  [180, [240, 70, 30, 245]], // often
  [235, [170, 0, 40, 255]],
  [255, [110, 0, 60, 255]],
];

// On a dark map "hotter" is brighter instead of darker: dim orange for a few rides up to near white for the most ridden
export const STOPS_DARK = [
  [0, [230, 90, 20, 0]],
  [20, [230, 90, 20, 90]],
  [40, [230, 100, 25, 170]], // ridden once or twice
  [110, [255, 150, 30, 225]], // a few times
  [180, [255, 215, 60, 250]], // often
  [235, [255, 245, 170, 255]],
  [255, [255, 255, 255, 255]],
];

// A 256-entry colour table, 4 bytes per entry
export function buildPalette(stops = STOPS) {
  const table = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    let hi = stops.findIndex(([at]) => at >= i);
    if (hi === -1) hi = stops.length - 1;
    const lo = Math.max(0, hi - 1);
    const [a0, c0] = stops[lo];
    const [a1, c1] = stops[hi];
    const t = a1 === a0 ? 0 : Math.min(1, Math.max(0, (i - a0) / (a1 - a0)));
    for (let k = 0; k < 4; k++) table[i * 4 + k] = Math.round(c0[k] + (c1[k] - c0[k]) * t);
  }
  return table;
}

// How many rides the busiest streets have: a high percentile of the non-zero counts, never below MIN_PEAK
export function busiestCount(counts) {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (const c of counts) {
    if (c > 0) {
      histogram[c] += 1;
      total += 1;
    }
  }
  if (total === 0) return MIN_PEAK;
  let seen = 0;
  for (let c = 1; c < 256; c++) {
    seen += histogram[c];
    if (seen >= total * PEAK_PERCENTILE) return Math.max(MIN_PEAK, c);
  }
  return 255;
}

// 0 for streets nobody rode, otherwise 40..255 relative to the busiest streets
export function levelFor(count, peak) {
  if (count <= 0) return 0;
  return Math.min(255, Math.max(MIN_LEVEL, Math.round(255 * (count / peak) ** GAMMA)));
}

// Turns the per-pixel ride counts (red channel) into colours. Pixels nobody rode through become transparent.
export function colorize(imageData, palette) {
  const d = imageData.data;
  const counts = [];
  for (let i = 0; i < d.length; i += 4) counts.push(d[i]);
  const peak = busiestCount(counts);
  for (let i = 0; i < d.length; i += 4) {
    const level = levelFor(d[i], peak);
    const j = level * 4;
    d[i] = palette[j];
    d[i + 1] = palette[j + 1];
    d[i + 2] = palette[j + 2];
    d[i + 3] = palette[j + 3];
  }
  return imageData;
}

// Draws each route as one path, so a ride crossing itself still counts once
export function strokeRoutes(ctx, routes, project, { width = LINE_WIDTH, size } = {}) {
  ctx.globalCompositeOperation = 'lighter'; // add up where rides overlap
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgb(1,0,0)'; // one ride adds 1 to the red channel
  let drawn = 0;
  for (const route of routes) {
    if (!route.points || route.points.length < 2) continue;
    const pts = route.points.map(([lat, lon]) => project(lat, lon));
    if (size) {
      // skip rides that are entirely off screen
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      if (Math.max(...xs) < -width || Math.min(...xs) > size.x + width || Math.max(...ys) < -width || Math.min(...ys) > size.y + width) continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    drawn += 1;
  }
  ctx.globalCompositeOperation = 'source-over';
  return drawn;
}

export default function HeatLayer({ routes, dark = false }) {
  const map = useMap();

  useEffect(() => {
    const canvas = L.DomUtil.create('canvas', 'bikeledger-heat');
    canvas.style.pointerEvents = 'none';
    canvas.style.position = 'absolute';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined; // no canvas support: nothing to draw
    const palette = buildPalette(dark ? STOPS_DARK : STOPS);
    const pane = map.getPane('overlayPane');
    pane.appendChild(canvas);

    const draw = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      ctx.clearRect(0, 0, size.x, size.y);
      strokeRoutes(ctx, routes, (lat, lon) => map.latLngToContainerPoint([lat, lon]), { size });
      ctx.putImageData(colorize(ctx.getImageData(0, 0, size.x, size.y), palette), 0, 0);
      canvas.style.visibility = 'visible';
    };
    // while the map zooms the old picture would be at the wrong scale: hide it and redraw afterwards
    const hide = () => { canvas.style.visibility = 'hidden'; };

    map.on('moveend zoomend resize', draw);
    map.on('zoomstart', hide);
    draw();
    return () => {
      map.off('moveend zoomend resize', draw);
      map.off('zoomstart', hide);
      canvas.remove();
    };
  }, [map, routes, dark]);

  return null;
}
