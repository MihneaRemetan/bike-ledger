import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataPage from '../../pages/DataPage';
import Statistics from '../../pages/Statistics';
import { download } from '../../api/client';
import { renderWithProviders, mockApi, fail, USER } from '../../test/utils';

vi.mock('@mui/x-charts/BarChart', () => ({
  BarChart: (p) => <div data-testid="bar-chart" data-dataset={JSON.stringify(p.dataset)} />,
}));

// A fetch that serves a downloadable file and records the requests
function stubDownloads(handler) {
  const urls = [];
  const clicks = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicks.push({ href: this.href, name: this.download }); });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/auth/me')) return { ok: true, status: 200, json: async () => USER }; // the session check
    urls.push({ url, init });
    return handler(url);
  }));
  return { urls, clicks };
}
const file = (name, body = 'x') => ({ ok: true, status: 200, headers: { get: (h) => (h === 'Content-Disposition' ? `attachment; filename="${name}"` : null) }, blob: async () => new Blob([body]) });

describe('download() helper', () => {
  test('fetches with the token, saves under the name the server gave and cleans up', async () => {
    localStorage.setItem('bikeledger.token', 'tok');
    const d = stubDownloads(() => file('bikeledger-2026-10-02.json'));
    const name = await download('/data/export', 'fallback.json');
    expect(name).toBe('bikeledger-2026-10-02.json');
    expect(d.urls[0].url).toBe('/api/data/export');
    expect(d.urls[0].init.headers.Authorization).toBe('Bearer tok');
    expect(d.clicks).toEqual([{ href: 'blob:fake', name: 'bikeledger-2026-10-02.json' }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(document.querySelector('a[download]')).toBeNull();
  });
  test('falls back to the given name and works without a token', async () => {
    const d = stubDownloads(() => ({ ok: true, headers: { get: () => null }, blob: async () => new Blob(['x']) }));
    expect(await download('/data/export/rides.csv', 'rides.csv')).toBe('rides.csv');
    expect(d.urls[0].init.headers).toEqual({});
  });
  test('errors carry the server message or a generic one; network failures too', async () => {
    stubDownloads(() => ({ ok: false, status: 401, json: async () => ({ error: 'Authentication required' }) }));
    await expect(download('/data/export', 'x')).rejects.toMatchObject({ status: 401, message: 'Authentication required' });
    stubDownloads(() => ({ ok: false, status: 500, json: async () => { throw new Error('no body'); } }));
    await expect(download('/data/export', 'x')).rejects.toMatchObject({ message: 'Download failed (500)' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(download('/data/export', 'x')).rejects.toMatchObject({ status: 0, message: 'Cannot reach the server' });
  });
});

describe('Data page: export', () => {
  const setup = (handler = () => file('f.json')) => {
    const d = stubDownloads(handler);
    renderWithProviders(<DataPage />, { route: '/data' });
    return d;
  };
  test('explains the page and offers the JSON backup and every spreadsheet', () => {
    mockApi();
    renderWithProviders(<DataPage />);
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download everything (JSON)' })).toBeInTheDocument();
    for (const n of ['Bikes', 'Components', 'Rides', 'Services', 'Maintenance rules']) expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
  });
  test('the JSON download hits /data/export, GPS tracks are optional', async () => {
    const d = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Download everything (JSON)' }));
    expect(await screen.findByText('Downloaded f.json')).toBeInTheDocument();
    expect(d.urls[0].url).toBe('/api/data/export');
    await userEvent.click(screen.getByRole('checkbox', { name: /Include GPS tracks/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Download everything (JSON)' }));
    await waitFor(() => expect(d.urls).toHaveLength(2));
    expect(d.urls[1].url).toBe('/api/data/export?tracks=true');
  });
  test.each([['Bikes', 'bikes'], ['Components', 'components'], ['Rides', 'rides'], ['Services', 'services'], ['Maintenance rules', 'rules']])('%s downloads %s.csv', async (name, key) => {
    const d = setup(() => file(`bikeledger-${key}.csv`));
    await userEvent.click(screen.getByRole('button', { name }));
    expect(await screen.findByText(`Downloaded bikeledger-${key}.csv`)).toBeInTheDocument();
    expect(d.urls[0].url).toBe(`/api/data/export/${key}.csv`);
  });
  test('buttons are disabled during a download, and a failure is reported', async () => {
    let finish;
    setup(() => new Promise((r) => { finish = () => r(file('f.json')); }));
    await userEvent.click(screen.getByRole('button', { name: 'Rides' }));
    expect(screen.getByRole('button', { name: 'Bikes' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bikes' })).toBeEnabled());
  });
  test('a failed download shows the error message', async () => {
    setup(() => ({ ok: false, status: 500, json: async () => ({ error: 'Internal server error' }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Bikes' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
});

describe('Data page: import', () => {
  const pickFile = (name = 'backup.json') => userEvent.upload(document.querySelector('input[type="file"]'), new File(['{}'], name, { type: 'application/json' }));
  const setup = (routes) => {
    const m = mockApi(routes);
    renderWithProviders(<DataPage />, { route: '/data' });
    return m;
  };
  test('warns that nothing is merged; Import needs a file', () => {
    setup({});
    expect(screen.getByText(/importing the same file twice creates duplicates/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
  test('uploads the chosen file and summarises what was imported', async () => {
    const m = setup({ 'POST /data/import': { imported: { bikes: 2, components: 5, rides: 120, services: 0, rules: 3, tracks: 0 } } });
    await pickFile();
    expect(screen.getByRole('button', { name: 'backup.json' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 2 bikes, 5 components, 120 rides, 3 rules.')).toBeInTheDocument();
    const form = m.called('POST', '/data/import')[0].body;
    expect(form.get('file').name).toBe('backup.json');
    expect(screen.getByRole('button', { name: 'Choose import file' })).toBeInTheDocument(); // reset for the next one
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
  test('an empty import says "nothing"', async () => {
    setup({ 'POST /data/import': { imported: { bikes: 0 } } });
    await pickFile();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported nothing.')).toBeInTheDocument();
  });
  test('problems are shown, with the first details, and the file stays selected for another try', async () => {
    setup({ 'POST /data/import': fail(400, { error: 'Validation failed', details: [{ field: 'bikes.0.name', message: 'Name is required' }, { field: 'rides.3.distanceKm', message: 'Must be greater than 0' }] }) });
    await pickFile();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Validation failed. bikes.0.name: Name is required; rides.3.distanceKm: Must be greater than 0');
    expect(screen.getByRole('button', { name: 'backup.json' })).toBeInTheDocument();
  });
  test('a plain error message without details', async () => {
    setup({ 'POST /data/import': fail(400, { error: 'The file is not valid JSON' }) });
    await pickFile('bad.json');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is not valid JSON');
  });
  test('choosing another file clears the previous result', async () => {
    setup({ 'POST /data/import': fail(400, { error: 'Nope' }) });
    await pickFile();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByRole('alert');
    await pickFile('other.json');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Statistics page', () => {
  const overview = (o = {}) => ({
    year: 2026, years: [2026, 2025],
    summary: { km: 4628.3, rides: 227, elevationM: 9629, movingMin: 12632, activeDays: 180, avgDistanceKm: 20.4, avgSpeedKmh: 22 },
    costs: { services: 240, parts: 520, total: 760, perKm: 0.164 },
    months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, km: i === 2 ? 700 : 0, rides: 0, elevationM: 0 })),
    bikes: [
      { id: 1, name: 'Gravel', type: 'GRAVEL', km: 3900, rides: 100, elevationM: 8000, movingMin: 10000, serviceCost: 145, costPerKm: 0.037 },
      { id: 2, name: 'Commuter', type: 'CITY', km: 728.3, rides: 127, elevationM: 1629, movingMin: 2632, serviceCost: 95, costPerKm: 0.13 },
    ],
    records: {
      longestRide: { id: 1, title: 'Long gravel', date: '2026-05-01T08:00:00Z', distanceKm: 59.3, bikeName: 'Gravel' },
      mostElevation: { id: 2, title: 'Big climb', date: '2026-06-01T08:00:00Z', elevationM: 1500, bikeName: 'Gravel' },
      fastestRide: { id: 3, title: 'Tailwind', date: '2026-07-01T08:00:00Z', avgSpeedKmh: 31.4, bikeName: 'Gravel' },
      bestMonth: { month: '2026-03', km: 700 },
    },
    parts: [
      { id: 1, type: 'BRAKE_PADS', brand: 'Swissstop', bikeName: 'Commuter', status: 'OK', price: 130, wearKm: 579.6, costPerKm: 0.224 },
      { id: 2, type: 'CABLES', brand: null, bikeName: 'Gravel', status: 'OK', price: 10, wearKm: 0, costPerKm: null },
    ],
    ...o,
  });
  const setup = (routes = {}) => {
    const m = mockApi({ 'GET /stats/overview': overview(), ...routes });
    renderWithProviders(<Statistics />, { route: '/statistics' });
    return m;
  };

  test('shows a placeholder while loading and an error when it fails', async () => {
    mockApi({ 'GET /stats/overview': () => new Promise(() => {}) });
    const { unmount } = renderWithProviders(<Statistics />);
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /stats/overview': fail(500, { error: 'Internal server error' }) });
    renderWithProviders(<Statistics />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
  test('headline numbers with their hints', async () => {
    setup();
    expect(await screen.findByText('4,628.3 km')).toBeInTheDocument();
    expect(screen.getByText('180 days on the bike')).toBeInTheDocument();
    expect(screen.getAllByText('Rides')[0].nextSibling).toHaveTextContent('227');
    expect(screen.getByText('20.4 km on average')).toBeInTheDocument();
    expect(screen.getByText('210:32 h')).toBeInTheDocument();
    expect(screen.getByText('22 km/h average')).toBeInTheDocument();
    expect(screen.getByText('9,629'.replace(',', '') + ' m')).toBeInTheDocument();
  });
  test('no ride times means no average speed', async () => {
    setup({ 'GET /stats/overview': overview({ summary: { km: 10, rides: 1, elevationM: 0, movingMin: 0, activeDays: 1, avgDistanceKm: 10, avgSpeedKmh: null } }) });
    expect(await screen.findByText('No ride times logged')).toBeInTheDocument();
  });
  test('costs: services, parts, total and per km', async () => {
    setup();
    const card = (await screen.findByText('What it cost in 2026')).closest('.MuiCard-root');
    expect(within(card).getByText('Services').nextSibling).toHaveTextContent(/RON\s?240\.00/);
    expect(within(card).getByText('Parts bought').nextSibling).toHaveTextContent(/RON\s?520\.00/);
    expect(within(card).getByText('Total').nextSibling).toHaveTextContent(/RON\s?760\.00/);
    expect(within(card).getByText('Per kilometre').nextSibling).toHaveTextContent(/RON\s?0\.16\/km/);
  });
  test('costs per km show a dash when nothing was ridden', async () => {
    setup({ 'GET /stats/overview': overview({ costs: { services: 0, parts: 0, total: 0, perKm: null } }) });
    const card = (await screen.findByText('What it cost in 2026')).closest('.MuiCard-root');
    expect(within(card).getByText('Per kilometre').nextSibling).toHaveTextContent('–');
  });
  test('the chart gets twelve months with short names', async () => {
    setup();
    const data = JSON.parse((await screen.findByTestId('bar-chart')).dataset.dataset);
    expect(data).toHaveLength(12);
    expect(data[0]).toEqual({ label: 'Jan', km: 0 });
    expect(data[2]).toEqual({ label: 'Mar', km: 700 });
  });
  test('records show value and context; missing ones explain what they need', async () => {
    setup();
    expect(await screen.findByText('59.3 km')).toBeInTheDocument();
    expect(screen.getByText(/Long gravel · .* · Gravel/)).toBeInTheDocument();
    expect(screen.getByText('1500 m')).toBeInTheDocument();
    expect(screen.getByText('31.4 km/h')).toBeInTheDocument();
    expect(screen.getByText('700.0 km')).toBeInTheDocument();
    expect(screen.getByText('Mar 2026')).toBeInTheDocument();
  });
  test('without records the cards show dashes', async () => {
    setup({ 'GET /stats/overview': overview({ records: { longestRide: null, mostElevation: null, fastestRide: null, bestMonth: null } }) });
    expect(await screen.findByText('Needs a ride of 10 km or more with a time')).toBeInTheDocument();
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(4);
  });
  test('by bike: linked names, figures and cost per km', async () => {
    setup();
    const row = (await screen.findByRole('link', { name: 'Commuter' })).closest('tr');
    expect(row).toHaveTextContent('728.3 km');
    expect(row).toHaveTextContent('127');
    expect(row).toHaveTextContent('43:52 h');
    expect(row).toHaveTextContent(/RON\s?0\.13\/km/);
    expect(screen.getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/1');
  });
  test('parts: price, km so far, cost per km, status; a dash when the part has no km yet', async () => {
    setup();
    const brake = (await screen.findByText('Brake pads · Swissstop')).closest('tr');
    expect(brake).toHaveTextContent('579.6 km');
    expect(brake).toHaveTextContent(/RON\s?0\.22\/km/);
    const cables = screen.getByText('Cables').closest('tr');
    expect(cables).toHaveTextContent('–');
  });
  test('empty lists have friendly messages', async () => {
    setup({ 'GET /stats/overview': overview({ bikes: [], parts: [] }) });
    expect(await screen.findByText('No bikes yet.')).toBeInTheDocument();
    expect(screen.getByText('Add a price to your parts to see this.')).toBeInTheDocument();
  });
  test('a year without rides says so', async () => {
    setup({ 'GET /stats/overview': overview({ year: 2025, summary: { km: 0, rides: 0, elevationM: 0, movingMin: 0, activeDays: 0, avgDistanceKm: 0, avgSpeedKmh: null } }) });
    expect(await screen.findByText(/No rides logged in 2025/)).toBeInTheDocument();
  });
  test('the year selector lists the available years and reloads for the chosen one', async () => {
    const m = setup({ 'GET /stats/overview': (c) => overview({ year: c.query.year ? Number(c.query.year) : 2026 }) });
    await screen.findByText('What it cost in 2026');
    expect(m.called('GET', '/stats/overview')[0].query).toEqual({});
    await userEvent.click(screen.getByRole('combobox', { name: 'Year' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['2026', '2025']);
    await userEvent.click(screen.getByRole('option', { name: '2025' }));
    expect(await screen.findByText('What it cost in 2025')).toBeInTheDocument();
    expect(m.called('GET', '/stats/overview').at(-1).query).toEqual({ year: '2025' });
  });
});
