import { vi } from 'vitest';
import { render } from '@testing-library/react';
import HeatLayer, {
  buildPalette, busiestCount, colorize, levelFor, strokeRoutes, STOPS, STOPS_DARK, MIN_PEAK, MIN_LEVEL, LINE_WIDTH,
} from '../../components/HeatLayer';

// the layer talks to a Leaflet map; a small fake is enough to see what it does
const fake = vi.hoisted(() => {
  const handlers = {};
  const pane = document.createElement('div');
  return {
    handlers, pane,
    map: {
      on: (names, fn) => names.split(' ').forEach((n) => { (handlers[n] ||= []).push(fn); }),
      off: (names, fn) => names.split(' ').forEach((n) => { handlers[n] = (handlers[n] || []).filter((f) => f !== fn); }),
      getPane: () => pane,
      getSize: () => ({ x: 4, y: 3 }),
      containerPointToLayerPoint: () => ({ x: 10, y: 20 }),
      latLngToContainerPoint: ([lat, lon]) => ({ x: lon, y: lat }),
    },
  };
});
vi.mock('react-leaflet', () => ({ useMap: () => fake.map }));

const pixels = (...reds) => ({ data: Uint8ClampedArray.from(reds.flatMap((r) => [r, 0, 0, r ? 255 : 0])) });
const rgba = (data, i) => [...data.slice(i * 4, i * 4 + 4)];

describe('palette', () => {
  test('has one colour per level and matches its stops exactly', () => {
    const p = buildPalette();
    expect(p).toHaveLength(256 * 4);
    for (const [level, color] of STOPS) expect([...p.slice(level * 4, level * 4 + 4)]).toEqual(color);
  });
  test('starts transparent and gets more opaque as it gets hotter', () => {
    const p = buildPalette();
    expect(p[3]).toBe(0);
    for (let i = 1; i < 256; i++) expect(p[i * 4 + 3]).toBeGreaterThanOrEqual(p[(i - 1) * 4 + 3]);
  });
  test('blends between two stops', () => {
    const p = buildPalette([[0, [0, 0, 0, 0]], [100, [100, 200, 50, 255]]]);
    expect([...p.slice(50 * 4, 50 * 4 + 4)]).toEqual([50, 100, 25, 128]);
  });
  test('stops that do not reach 255 keep the last colour', () => {
    const p = buildPalette([[0, [0, 0, 0, 0]], [100, [10, 20, 30, 255]]]);
    expect([...p.slice(255 * 4, 255 * 4 + 4)]).toEqual([10, 20, 30, 255]);
  });
  test('light maps go dark red for the busiest streets, dark maps go near white', () => {
    expect([...buildPalette(STOPS).slice(255 * 4, 255 * 4 + 3)]).toEqual([110, 0, 60]);
    expect([...buildPalette(STOPS_DARK).slice(255 * 4, 255 * 4 + 3)]).toEqual([255, 255, 255]);
  });
});

describe('how busy is busy', () => {
  test('with nothing drawn, or little riding, the peak never drops below the minimum', () => {
    expect(busiestCount([])).toBe(MIN_PEAK);
    expect(busiestCount([0, 0, 0])).toBe(MIN_PEAK);
    expect(busiestCount([1, 1, 2, 3])).toBe(MIN_PEAK);
  });
  test('with a lot of riding it follows the busy streets', () => {
    expect(busiestCount(Array(50).fill(30))).toBe(30);
    expect(busiestCount([...Array(98).fill(20), 100, 100])).toBe(20);
  });
  test('counts beyond what a pixel can hold fall back to the maximum', () => {
    expect(busiestCount([300, 400])).toBe(255);
  });
  test('one hot spot (2%) does not set the scale', () => {
    expect(busiestCount([...Array(98).fill(10), 250, 250])).toBe(10);
    expect(busiestCount([...Array(90).fill(10), ...Array(10).fill(250)])).toBe(250);
  });
  test('level: nothing for empty pixels, relative to the peak otherwise, never below the minimum', () => {
    expect(levelFor(0, 10)).toBe(0);
    expect(levelFor(8, 8)).toBe(255);
    expect(levelFor(20, 8)).toBe(255);
    expect(levelFor(1, 8)).toBeGreaterThanOrEqual(MIN_LEVEL);
    expect(levelFor(1, 200)).toBe(MIN_LEVEL);
    expect(levelFor(4, 8)).toBeGreaterThan(levelFor(2, 8));
  });
});

describe('colorize', () => {
  test('empty pixels become transparent, ridden pixels get the colour of their level', () => {
    const palette = buildPalette();
    const img = colorize(pixels(0, 1, 8), palette);
    expect(rgba(img.data, 0)[3]).toBe(0);
    const once = rgba(img.data, 1);
    const often = rgba(img.data, 2);
    expect(once[3]).toBeGreaterThan(0);
    expect(often).toEqual([110, 0, 60, 255]); // 8 of 8 is the hottest
    expect(once[3]).toBeLessThan(often[3]);
  });
  test('the scale follows the busiest streets: the same pixel is cooler when others are busier', () => {
    const palette = buildPalette();
    const alone = rgba(colorize(pixels(8), palette).data, 0);
    const amongBusy = rgba(colorize(pixels(8, ...Array(20).fill(200)), palette).data, 0);
    expect(amongBusy[3]).toBeLessThan(alone[3]);
  });
});

describe('strokeRoutes', () => {
  const ctxStub = () => {
    const calls = [];
    const rec = (name) => (...a) => calls.push([name, ...a]);
    return { calls, beginPath: rec('begin'), moveTo: rec('move'), lineTo: rec('line'), stroke: rec('stroke'), clearRect: rec('clear') };
  };
  const project = (lat, lon) => ({ x: lon, y: lat });

  test('strokes one path per route with additive blending, then restores normal blending', () => {
    const ctx = ctxStub();
    const modes = [];
    Object.defineProperty(ctx, 'globalCompositeOperation', { set: (v) => modes.push(v), get: () => modes.at(-1) });
    const drawn = strokeRoutes(ctx, [{ points: [[1, 1], [2, 2], [3, 3]] }, { points: [[4, 4], [5, 5]] }], project);
    expect(drawn).toBe(2);
    expect(ctx.calls.filter((c) => c[0] === 'stroke')).toHaveLength(2);
    expect(ctx.calls.filter((c) => c[0] === 'line')).toHaveLength(3);
    expect(modes).toEqual(['lighter', 'source-over']);
    expect(ctx.strokeStyle).toBe('rgb(1,0,0)');
    expect(ctx.lineWidth).toBe(LINE_WIDTH);
  });
  test('routes without enough points are ignored', () => {
    const ctx = ctxStub();
    expect(strokeRoutes(ctx, [{ points: [[1, 1]] }, { points: [] }, {}], project)).toBe(0);
  });
  test('routes entirely off screen are skipped', () => {
    const ctx = ctxStub();
    const size = { x: 100, y: 100 };
    const routes = [{ points: [[10, 10], [20, 20]] }, { points: [[500, 500], [600, 600]] }, { points: [[-300, 50], [-200, 60]] }, { points: [[-50, 50], [50, 50]] }];
    expect(strokeRoutes(ctx, routes, project, { size })).toBe(2); // inside, and one crossing the edge
  });
});

describe('HeatLayer', () => {
  let putImageData;
  const mount = (props = {}) => render(<HeatLayer routes={[{ points: [[1, 1], [2, 2]] }]} {...props} />);

  beforeEach(() => {
    fake.pane.innerHTML = '';
    document.body.appendChild(fake.pane); // so that "in the document" means something
    for (const k of Object.keys(fake.handlers)) delete fake.handlers[k];
    putImageData = vi.fn();
    const ctx = {
      clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), putImageData,
      getImageData: vi.fn(() => ({ data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 0, 0]) })),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  });

  test('puts a canvas that ignores the mouse in the map overlay pane and draws on it', () => {
    mount();
    const canvas = fake.pane.querySelector('canvas.bikeledger-heat');
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.pointerEvents).toBe('none');
    expect([canvas.width, canvas.height]).toEqual([4, 3]);
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(canvas.style.visibility).toBe('visible');
  });
  test('redraws when the map moves, zooms or resizes', () => {
    mount();
    for (const name of ['moveend', 'zoomend', 'resize']) {
      const before = putImageData.mock.calls.length;
      fake.handlers[name].forEach((fn) => fn());
      expect(putImageData.mock.calls.length).toBe(before + 1);
    }
  });
  test('hides while the map zooms and shows again once it has redrawn', () => {
    mount();
    const canvas = fake.pane.querySelector('canvas');
    fake.handlers.zoomstart.forEach((fn) => fn());
    expect(canvas.style.visibility).toBe('hidden');
    fake.handlers.zoomend.forEach((fn) => fn());
    expect(canvas.style.visibility).toBe('visible');
  });
  test('uses the light palette on a light map and the bright one on a dark map', () => {
    const { unmount } = mount();
    expect([...putImageData.mock.calls[0][0].data.slice(0, 4)]).toEqual([110, 0, 60, 255]);
    unmount();
    putImageData.mockClear();
    mount({ dark: true });
    expect([...putImageData.mock.calls[0][0].data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });
  test('redraws when the routes change', () => {
    const { rerender } = mount();
    expect(putImageData).toHaveBeenCalledTimes(1);
    rerender(<HeatLayer routes={[{ points: [[1, 1], [3, 3]] }]} />);
    expect(putImageData).toHaveBeenCalledTimes(2);
    expect(fake.pane.querySelectorAll('canvas')).toHaveLength(1); // the old one is gone
  });
  test('cleans up: removes the canvas and the map listeners', () => {
    const { unmount } = mount();
    unmount();
    expect(fake.pane.querySelector('canvas')).toBeNull();
    for (const name of ['moveend', 'zoomend', 'resize', 'zoomstart']) expect(fake.handlers[name]).toHaveLength(0);
  });
  test('does nothing, without failing, when the browser has no canvas', () => {
    HTMLCanvasElement.prototype.getContext.mockReturnValue(null);
    mount();
    expect(fake.pane.querySelector('canvas')).toBeNull();
    expect(putImageData).not.toHaveBeenCalled();
  });
});
