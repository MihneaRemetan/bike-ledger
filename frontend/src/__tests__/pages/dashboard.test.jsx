import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../../pages/Dashboard';
import { renderWithProviders, mockApi, fail, component, rule, USER } from '../../test/utils';

vi.mock('@mui/x-charts/BarChart', () => ({
  BarChart: (p) => <div data-testid="bar-chart" data-dataset={JSON.stringify(p.dataset)} data-label={p.series[0].label} />,
}));

const months = (km = 0) => Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, km: i === 11 ? km : 0, cost: 0 }));
const stats = (o = {}) => ({
  totals: { bikes: 2, rides: 245, km: 7486.2, elevationM: 64501, maintenanceCost: 260, activeComponents: 7, ...(o.totals || {}) },
  months: o.months || months(310.5),
  alerts: o.alerts || [],
  maintenance: o.maintenance || [],
});
const setup = (data, extra = {}) => {
  const m = mockApi({ 'GET /stats/dashboard': data, ...extra });
  renderWithProviders(<Dashboard />, { route: '/dashboard' });
  return m;
};

describe('Dashboard: loading and errors', () => {
  test('shows placeholders while loading', () => {
    mockApi({ 'GET /stats/dashboard': () => new Promise(() => {}) });
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThanOrEqual(4);
  });
  test('shows the server error', async () => {
    setup(fail(500, { error: 'Internal server error' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
});

describe('Dashboard: a new user', () => {
  const empty = stats({ totals: { bikes: 0, rides: 0, km: 0, elevationM: 0, maintenanceCost: 0, activeComponents: 0 } });
  test('is welcomed by first name with the three setup steps and no statistics', async () => {
    setup(empty);
    expect(await screen.findByRole('heading', { name: `Welcome, ${USER.name.split(' ')[0]}` })).toBeInTheDocument();
    expect(screen.getByText('Get started with BikeLedger')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
    for (const b of ['Add bike', 'Add parts', 'Log a ride']) expect(screen.getByRole('button', { name: b })).toBeInTheDocument();
    expect(screen.queryByText('Total distance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
  test('"Add bike" opens the bike form; saving it reloads the dashboard', async () => {
    let created = false;
    const m = setup(() => (created ? stats({ totals: { bikes: 1, rides: 0, km: 0, elevationM: 0, maintenanceCost: 0, activeComponents: 0 } }) : empty), {
      'POST /bikes': () => { created = true; return { id: 1, name: 'First' }; },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Add bike' }));
    expect(await screen.findByText('Add bike', { selector: 'h2' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Name/), 'First');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('1 of 3 done')).toBeInTheDocument());
    expect(m.called('GET', '/stats/dashboard')).toHaveLength(2);
    expect(screen.getByText('Total distance')).toBeInTheDocument();
  });
  test('"Add parts" leads to the components page', async () => {
    setup(stats({ totals: { bikes: 1, rides: 0, km: 0, elevationM: 0, maintenanceCost: 0, activeComponents: 0 } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add parts' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/components');
  });
  test('the ride step leads to /rides', async () => {
    setup(stats({ totals: { bikes: 1, rides: 0, km: 0, elevationM: 0, maintenanceCost: 0, activeComponents: 2 } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Log a ride' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/rides');
  });
});

describe('Dashboard: with data', () => {
  test('shows the four headline numbers, formatted', async () => {
    setup(stats({ alerts: [component({ id: 1, status: 'WARN', wearPct: 0.9, wearKm: 3600, maxKm: 4000 })] }));
    expect(await screen.findByText('Total distance')).toBeInTheDocument();
    expect(screen.getByText('7,486.2 km')).toBeInTheDocument();
    expect(screen.getByText('Rides').nextSibling).toHaveTextContent('245');
    expect(screen.getByText(/RON\s?260\.00/)).toBeInTheDocument();
    expect(screen.getByText('Parts needing attention').nextSibling).toHaveTextContent('1');
  });
  test('the chart gets one bar per month with short labels', async () => {
    setup(stats({ months: [{ month: '2025-01', km: 100 }, { month: '2025-12', km: 55.5 }] }));
    const chart = await screen.findByTestId('bar-chart');
    expect(JSON.parse(chart.dataset.dataset)).toEqual([{ label: 'Jan 25', km: 100 }, { label: 'Dec 25', km: 55.5 }]);
    expect(screen.getByText('Kilometres per month')).toBeInTheDocument();
  });
  test('lists each alert with part, brand, a link to its bike and its wear', async () => {
    setup(stats({
      alerts: [
        component({ id: 1, type: 'TYRE_REAR', brand: 'Schwalbe', bikeId: 7, bikeName: 'Gravel', status: 'REPLACE', wearPct: 1.06, wearKm: 4237, maxKm: 4000 }),
        component({ id: 2, type: 'CHAIN', brand: null, bikeId: 8, bikeName: 'Commuter', status: 'WARN', wearPct: 0.86, wearKm: 3430, maxKm: 4000 }),
      ],
    }));
    const section = (await screen.findByText('Wear alerts')).closest('.MuiCardContent-root');
    expect(within(section).getByText('Rear tyre · Schwalbe')).toBeInTheDocument();
    expect(within(section).getByText('Chain')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/7');
    expect(within(section).getByRole('link', { name: 'Commuter' })).toHaveAttribute('href', '/bikes/8');
    expect(within(section).getByText('Replace now')).toBeInTheDocument();
    expect(within(section).getByText('4237 / 4000 km (106%)')).toBeInTheDocument();
  });
  test('lists maintenance that is due, with the bike, the progress and the status', async () => {
    setup(stats({
      maintenance: [
        rule({ id: 1, title: 'Brake and gear adjustment', bikeId: 7, bikeName: 'Gravel', status: 'OVERDUE', pct: 1.1, everyKm: 1800, kmSince: 2044, everyDays: 365, daysSince: 150 }),
        rule({ id: 2, title: 'Clean and lube the chain', bikeId: 8, bikeName: 'Commuter', status: 'DUE', pct: 0.86, everyKm: 230, kmSince: 197 }),
      ],
    }));
    const section = (await screen.findByText('Maintenance due')).closest('.MuiCardContent-root');
    expect(within(section).getByText('Brake and gear adjustment')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/7');
    expect(within(section).getByRole('link', { name: 'Commuter' })).toHaveAttribute('href', '/bikes/8');
    expect(within(section).getByText('Overdue')).toBeInTheDocument();
    expect(within(section).getByText('Due soon')).toBeInTheDocument();
    expect(within(section).getByText('2044 / 1800 km · 150 / 365 days')).toBeInTheDocument();
  });
  test('no maintenance card when nothing is due', async () => {
    setup(stats());
    await screen.findByText('Total distance');
    expect(screen.queryByText('Maintenance due')).not.toBeInTheDocument();
  });
  test('an older server answer without a maintenance list still works', async () => {
    const { maintenance, ...old } = stats();
    setup(old);
    expect(await screen.findByText('Total distance')).toBeInTheDocument();
  });
  test('each alert shows when the part is expected to reach its limit and offers a way to buy a replacement', async () => {
    setup(stats({
      alerts: [component({ id: 1, type: 'CHAIN', brand: 'KMC', model: 'X11', bikeId: 7, bikeName: 'Gravel', status: 'WARN', wearPct: 0.9, wearKm: 3600, maxKm: 4000, forecast: { status: 'DATE', date: '2026-12-14', daysLeft: 70, kmPerDay: 5.7, windowDays: 90, remainingKm: 400 } })],
    }));
    expect(await screen.findByText(/Limit expected 14 Dec 2026 \(in about 2 months\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buy a replacement' }));
    expect(await screen.findByText('Search for “KMC X11 chain”')).toBeInTheDocument();
  });
  test('without alerts it says everything is fine', async () => {
    setup(stats());
    expect(await screen.findByText('All components are in good shape.')).toBeInTheDocument();
    expect(screen.getByText('Parts needing attention').nextSibling).toHaveTextContent('0');
  });
  test('the setup checklist is hidden once there is a bike, parts and a ride', async () => {
    setup(stats());
    await screen.findByText('Total distance');
    expect(screen.queryByText('Get started with BikeLedger')).not.toBeInTheDocument();
  });
  test('the checklist stays above the numbers while something is still missing', async () => {
    setup(stats({ totals: { bikes: 1, rides: 5, km: 100, elevationM: 0, maintenanceCost: 0, activeComponents: 0 } }));
    expect(await screen.findByText('Get started with BikeLedger')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument();
    expect(screen.getByText('Total distance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add bike' })).not.toBeInTheDocument();
  });
});
