import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { ColorModeProvider } from '../ColorMode';
import { AuthProvider } from '../auth/AuthContext';
import { NotifyProvider } from '../components/Notify';
import { session } from '../api/client';
import { mockApi, USER } from '../test/utils';

vi.mock('@mui/x-charts/BarChart', () => ({ BarChart: () => <div data-testid="bar-chart" /> }));
vi.mock('react-leaflet', () => ({ MapContainer: () => <div />, TileLayer: () => null, Polyline: () => null, Popup: () => null, Marker: () => null, Circle: () => null, Tooltip: () => null, useMap: () => ({}) }));

const DASH = { totals: { bikes: 0, rides: 0, km: 0, elevationM: 0, maintenanceCost: 0, activeComponents: 0 }, months: [], alerts: [] };
const routes = (extra = {}) => ({
  'GET /auth/me': USER, 'GET /stats/dashboard': DASH, 'GET /bikes': [], 'GET /components': [], 'GET /rides': [], 'GET /services': [], 'GET /rides/routes': [], 'GET /maintenance/rules': [],
  'GET /stats/overview': { year: 2026, years: [2026], summary: { km: 0, rides: 0, elevationM: 0, movingMin: 0, activeDays: 0, avgDistanceKm: 0, avgSpeedKmh: null }, costs: { services: 0, parts: 0, total: 0, perKm: null }, months: [], bikes: [], records: { longestRide: null, mostElevation: null, fastestRide: null, bestMonth: null }, parts: [] }, ...extra,
});
const renderApp = (route, { loggedIn = false } = {}) => {
  if (loggedIn) session.save('tok', USER);
  return render(
    <ColorModeProvider><MemoryRouter initialEntries={[route]}><NotifyProvider><AuthProvider><App /></AuthProvider></NotifyProvider></MemoryRouter></ColorModeProvider>
  );
};

describe('routing and access control', () => {
  test('a visitor sees the landing page at /', () => {
    mockApi(routes());
    renderApp('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Know when your bike parts wear out/);
  });
  test.each(['/dashboard', '/bikes', '/bikes/3', '/components', '/rides', '/map', '/services', '/statistics', '/data'])('a visitor opening %s is sent to the login page', async (path) => {
    mockApi(routes());
    renderApp(path);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
  test('login and register are reachable without an account', () => {
    mockApi(routes());
    renderApp('/register');
    expect(screen.getByRole('heading', { name: 'Start tracking your bikes' })).toBeInTheDocument();
  });
  test('a logged-in user opening / or /login lands on the dashboard', async () => {
    mockApi(routes());
    renderApp('/', { loggedIn: true });
    expect(await screen.findByText(/Welcome, Mihnea/)).toBeInTheDocument();
  });
  test('a logged-in user opening /login is redirected to the dashboard', async () => {
    mockApi(routes());
    renderApp('/login', { loggedIn: true });
    expect(await screen.findByText(/Welcome, Mihnea/)).toBeInTheDocument();
  });
  test('while the saved session is being checked a spinner is shown instead of the page', async () => {
    let finish;
    mockApi(routes({ 'GET /auth/me': () => new Promise((r) => { finish = () => r(USER); }) }));
    renderApp('/bikes', { loggedIn: true });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    finish();
    expect(await screen.findByRole('heading', { name: 'Bikes' })).toBeInTheDocument();
  });
  test('an expired saved session ends up on the login page', async () => {
    vi.stubGlobal('location', { pathname: '/bikes', assign: vi.fn() });
    mockApi(routes({ 'GET /auth/me': { __status: 401, body: { error: 'expired' } } }));
    renderApp('/bikes', { loggedIn: true });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
  test('unknown addresses go back to the landing page for visitors', async () => {
    mockApi(routes());
    renderApp('/no/such/page');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Know when/);
  });
  test('each section opens from the sidebar', async () => {
    mockApi(routes());
    renderApp('/bikes', { loggedIn: true });
    await screen.findByRole('heading', { name: 'Bikes' });
    for (const [link, heading] of [['Components', 'Components'], ['Rides', 'Rides'], ['Map', 'Map'], ['Services', 'Services'], ['Statistics', 'Statistics'], ['Data', 'Data'], ['Dashboard', /Welcome/]]) {
      await userEvent.click(screen.getByRole('link', { name: link }));
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });
  test('logging out returns to the login page', async () => {
    mockApi(routes());
    renderApp('/bikes', { loggedIn: true });
    await userEvent.click(await screen.findByRole('button', { name: 'User menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(session.token).toBeNull();
  });
  test('the full journey: log in from the login page and arrive on the dashboard', async () => {
    mockApi(routes({ 'POST /auth/login': { token: 'abc', user: USER } }));
    renderApp('/login');
    await userEvent.type(screen.getByLabelText(/^Email/), 'mihnea@test.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(screen.getByText(/Welcome, Mihnea/)).toBeInTheDocument());
  });
});
