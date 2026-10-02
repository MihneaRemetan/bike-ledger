import { renderHook, waitFor, act } from '@testing-library/react';
import { fmtKm, fmtMoney, fmtDate, fmtDuration, fmtElev, todayStr, toLocalInput, lowerFirst } from '../lib/format';
import { BIKE_TYPES, COMPONENT_TYPES, SERVICE_TYPES, STATUS_LABELS, toOptions, label } from '../lib/constants';
import { useLoad } from '../lib/useLoad';

describe('format', () => {
  test('fmtKm: one decimal with thousands separators, dash for missing', () => {
    expect(fmtKm(1234.56)).toBe('1,234.6 km');
    expect(fmtKm(0)).toBe('0.0 km');
    expect(fmtKm(null)).toBe('–');
    expect(fmtKm(undefined)).toBe('–');
  });
  test('fmtMoney: RON with two decimals', () => {
    expect(fmtMoney(150)).toMatch(/RON\s?150\.00/);
    expect(fmtMoney(0.5)).toMatch(/0\.50/);
    expect(fmtMoney(null)).toBe('–');
  });
  test('fmtDate: short date from date-only and ISO strings, dash when missing or invalid', () => {
    expect(fmtDate('2025-05-01')).toBe('01 May 2025');
    expect(fmtDate('2026-09-13')).toMatch(/^13 Sep(t)? 2026$/);
    expect(fmtDate('2025-12-31T23:00:00Z')).toMatch(/(31 Dec|01 Jan) \d{4}/);
    expect(fmtDate(null)).toBe('–');
    expect(fmtDate('')).toBe('–');
    expect(fmtDate('garbage')).toBe('–');
  });
  test('fmtDuration: h:mm', () => {
    expect(fmtDuration(95)).toBe('1:35');
    expect(fmtDuration(5)).toBe('0:05');
    expect(fmtDuration(600)).toBe('10:00');
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(null)).toBe('–');
  });
  test('fmtElev', () => {
    expect(fmtElev(300)).toBe('300 m');
    expect(fmtElev(0)).toBe('0 m');
    expect(fmtElev(null)).toBe('–');
  });
  test('todayStr is YYYY-MM-DD for today (UTC)', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayStr()).toBe(new Date().toISOString().slice(0, 10));
  });
  test('toLocalInput gives a datetime-local value and round-trips', () => {
    const v = toLocalInput('2025-05-01T08:30:00Z');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(v).getTime()).toBe(new Date('2025-05-01T08:30:00Z').getTime());
    expect(toLocalInput()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  test('lowerFirst', () => {
    expect(lowerFirst('Rear tyre')).toBe('rear tyre');
    expect(lowerFirst('')).toBe('');
  });
});

describe('constants', () => {
  test('friendly labels for every enum value the API can return', () => {
    expect(Object.keys(BIKE_TYPES)).toEqual(['ROAD', 'MTB', 'GRAVEL', 'CITY', 'OTHER']);
    expect(Object.keys(COMPONENT_TYPES)).toHaveLength(10);
    expect(Object.keys(SERVICE_TYPES)).toEqual(['REPLACE', 'CLEAN', 'ADJUST', 'REPAIR', 'INSPECTION']);
    expect(COMPONENT_TYPES.TYRE_REAR).toBe('Rear tyre');
    expect(COMPONENT_TYPES.BRAKE_PADS).toBe('Brake pads');
    expect(BIKE_TYPES.GRAVEL).toBe('Gravel');
    expect(SERVICE_TYPES.REPLACE).toBe('Replacement');
    expect(Object.keys(STATUS_LABELS)).toEqual(['OK', 'WARN', 'REPLACE', 'RETIRED']);
  });
  test('toOptions builds select options and label falls back to the raw key', () => {
    expect(toOptions({ A: 'Alpha', B: 'Beta' })).toEqual([{ value: 'A', label: 'Alpha' }, { value: 'B', label: 'Beta' }]);
    expect(label(BIKE_TYPES, 'ROAD')).toBe('Road');
    expect(label(BIKE_TYPES, 'UNKNOWN')).toBe('UNKNOWN');
    expect(label(BIKE_TYPES, null)).toBe('');
  });
});

describe('useLoad', () => {
  test('starts loading, then exposes data', async () => {
    const { result } = renderHook(() => useLoad(async () => [1, 2], []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });
  test('exposes the error when loading fails', async () => {
    const { result } = renderHook(() => useLoad(async () => { throw new Error('nope'); }, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error.message).toBe('nope');
    expect(result.current.data).toBeNull();
  });
  test('reload fetches again without flipping back to the loading state', async () => {
    let n = 0;
    const { result } = renderHook(() => useLoad(async () => ++n, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(() => result.current.reload());
    expect(result.current.data).toBe(2);
    expect(result.current.loading).toBe(false);
  });
  test('reload reports failures and keeps the previous data', async () => {
    let fail = false;
    const { result } = renderHook(() => useLoad(async () => { if (fail) throw new Error('later'); return 'ok'; }, []));
    await waitFor(() => expect(result.current.data).toBe('ok'));
    fail = true;
    await act(() => result.current.reload());
    expect(result.current.error.message).toBe('later');
    expect(result.current.data).toBe('ok');
  });
  test('re-runs when the dependencies change', async () => {
    const { result, rerender } = renderHook(({ id }) => useLoad(async () => `item-${id}`, [id]), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.data).toBe('item-1'));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toBe('item-2'));
  });
  test('ignores a response that arrives after the dependencies changed', async () => {
    let resolveFirst;
    const { result, rerender } = renderHook(({ id }) => useLoad(() => (id === 1 ? new Promise((r) => { resolveFirst = r; }) : Promise.resolve('second')), [id]), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toBe('second'));
    await act(async () => resolveFirst('stale'));
    expect(result.current.data).toBe('second');
  });
});
