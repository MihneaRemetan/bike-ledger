import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { ColorModeProvider } from '../ColorMode';
import { AuthProvider } from '../auth/AuthContext';
import { NotifyProvider } from '../components/Notify';
import { session } from '../api/client';

export const USER = { id: 1, name: 'Mihnea Remetan', email: 'mihnea@test.dev' };

// Fake backend: `routes` maps "METHOD /path" (without /api and without the query string) to a response.
// A handler may be a value, or a function (request) => value | { status, body }.
export function mockApi(routes = {}) {
  routes = { 'GET /auth/me': USER, ...routes }; // the session check every logged-in page triggers
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const [path, qs = ''] = String(url).replace(/^\/api/, '').split('?');
    let body;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body instanceof FormData) body = init.body;
    const call = { method, path, query: Object.fromEntries(new URLSearchParams(qs)), body, headers: init.headers || {}, url };
    calls.push(call);
    const key = `${method} ${path}`;
    const handler = routes[key];
    if (handler === undefined) return respond(404, { error: `No mock for ${key}` });
    const out = typeof handler === 'function' ? await handler(call) : handler;
    if (out && typeof out === 'object' && '__status' in out) return respond(out.__status, out.body);
    return respond(method === 'DELETE' ? 204 : 200, out);
  });
  vi.stubGlobal('fetch', fn);
  fn.calls = calls;
  fn.called = (method, path) => calls.filter((c) => c.method === method && c.path === path);
  return fn;
}
// A handler can return fail(400, {...}) to simulate an error response
export const fail = (status, body) => ({ __status: status, body });

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (status === 204) throw new Error('no body');
      return body;
    },
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

// Renders `ui` at `route` with every provider the app uses. Pass `user: null` for a logged-out visitor.
export function renderWithProviders(ui, { route = '/', user = USER, path = '*', mode } = {}) {
  if (user) session.save('test-token', user);
  if (mode) localStorage.setItem('bikeledger.mode', mode);
  return render(
    <ColorModeProvider>
      <MemoryRouter initialEntries={[route]}>
        <NotifyProvider>
          <AuthProvider>
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
            <LocationProbe />
          </AuthProvider>
        </NotifyProvider>
      </MemoryRouter>
    </ColorModeProvider>
  );
}

// Test data factories
export const bike = (o = {}) => ({ id: 1, name: 'Gravel', brand: 'Canyon', model: 'Grizl', type: 'GRAVEL', year: 2024, notes: null, totalKm: 1234.5, rideCount: 20, maintenanceCost: 150, activeComponents: 3, alerts: 0, ...o });
export const component = (o = {}) => ({ id: 10, bikeId: 1, bikeName: 'Gravel', type: 'CHAIN', brand: 'KMC', model: 'X11', installedAt: '2025-01-01', retiredAt: null, initialKm: 0, maxKm: 4000, price: 100, wearKm: 1000, wearPct: 0.25, remainingKm: 3000, status: 'OK', ...o });
export const ride = (o = {}) => ({ id: 5, bikeId: 1, bikeName: 'Gravel', date: '2025-05-01T08:00:00.000Z', title: 'Morning ride', distanceKm: 42.5, durationMin: 95, elevationM: 300, source: 'MANUAL', hasRoute: false, ...o });
export const service = (o = {}) => ({ id: 7, bikeId: 1, bikeName: 'Gravel', componentId: 10, componentType: 'CHAIN', componentBrand: 'KMC', componentModel: 'X11', date: '2025-04-01', type: 'CLEAN', cost: 25, notes: 'Deep clean', ...o });
export const rule = (o = {}) => ({
  id: 3, bikeId: 1, bikeName: 'Gravel', componentId: null, componentType: null, title: 'Clean and lube the chain', serviceType: 'CLEAN',
  everyKm: 300, everyDays: null, startDate: '2026-01-01', lastDoneAt: '2026-09-01', lastServiceAt: '2026-09-01', kmSince: 186.3, kmRemaining: 113.7,
  daysSince: 30, daysRemaining: null, nextDueDate: null, pct: 0.621, status: 'OK', ...o,
});
