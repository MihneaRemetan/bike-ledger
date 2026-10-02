import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BikeDetail from '../../pages/BikeDetail';
import { renderWithProviders, mockApi, fail, bike, component, ride, service, rule } from '../../test/utils';

const chain = component({ id: 10, type: 'CHAIN', brand: 'KMC', model: 'X11', status: 'WARN', wearKm: 3430, maxKm: 4000, wearPct: 0.86 });
const tyre = component({ id: 11, type: 'TYRE_REAR', brand: 'Schwalbe', model: null, status: 'OK' });
const oldPart = component({ id: 12, type: 'CASSETTE', brand: 'Old', model: null, retiredAt: '2025-03-01', status: 'RETIRED', wearKm: 2100 });
const detail = (o = {}) => ({
  ...bike({ id: 1, name: 'Gravel', brand: 'Canyon', model: 'Grizl', year: 2024, type: 'GRAVEL', notes: 'Weekend bike' }),
  totalKm: 4375.1, rideCount: 114, maintenanceCost: 145, costPerKm: 0.033,
  components: [chain, tyre, oldPart],
  recentRides: [ride({ id: 5, title: 'Morning ride', distanceKm: 42.5, durationMin: 95, source: 'MANUAL' }), ride({ id: 6, title: 'GPS ride', source: 'GPX', distanceKm: 30, durationMin: null })],
  recentServices: [service({ id: 7, type: 'REPLACE', componentType: 'CHAIN', componentBrand: 'KMC', componentModel: 'X11', cost: 120, notes: 'New chain' }), service({ id: 8, type: 'CLEAN', componentId: null, componentType: null, cost: null, notes: null })],
  ...o,
});
const setup = (data = detail(), routes = {}) => {
  const m = mockApi({ 'GET /bikes/1': data, 'GET /bikes': [bike({ id: 1, name: 'Gravel' }), bike({ id: 2, name: 'Commuter' })], 'GET /components': [chain, tyre], 'GET /components/defaults': { CHAIN: 4000 }, 'GET /maintenance/rules': [], ...routes });
  renderWithProviders(<BikeDetail />, { route: '/bikes/1', path: '/bikes/:id' });
  return m;
};
const section = (title) => screen.getByText(title, { selector: 'h6' }).closest('.MuiCard-root');

describe('BikeDetail', () => {
  test('shows the bike name, details, notes and the four statistics', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Gravel' })).toBeInTheDocument();
    expect(screen.getByText('Gravel · Canyon · Grizl · 2024')).toBeInTheDocument();
    expect(screen.getByText('Weekend bike')).toBeInTheDocument();
    expect(screen.getByText('4,375.1 km')).toBeInTheDocument();
    expect(screen.getByText('Rides').nextSibling).toHaveTextContent('114');
    expect(screen.getByText('Maintenance cost').nextSibling).toHaveTextContent(/RON\s?145\.00/);
    expect(screen.getByText('Cost per km').nextSibling).toHaveTextContent(/RON\s?0\.03\/km/);
  });
  test('shows "bike not found" for unknown bikes and the server message for other errors', async () => {
    mockApi({ 'GET /bikes/1': fail(404, { error: 'Bike not found' }), 'GET /bikes': [] });
    const { unmount } = renderWithProviders(<BikeDetail />, { route: '/bikes/1', path: '/bikes/:id' });
    expect(await screen.findByText('Bike not found')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /bikes/1': fail(500, { error: 'Internal server error' }), 'GET /bikes': [] });
    renderWithProviders(<BikeDetail />, { route: '/bikes/1', path: '/bikes/:id' });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });

  describe('components', () => {
    test('active parts are listed with wear bars; retired ones are collapsed', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      const c = within(section('Components'));
      expect(c.getByText('Chain · KMC X11')).toBeInTheDocument();
      expect(c.getByText('Rear tyre · Schwalbe')).toBeInTheDocument();
      expect(c.getByText('3430 / 4000 km (86%)')).toBeInTheDocument();
      expect(c.getByText('Wearing out')).toBeInTheDocument();
      expect(c.getByRole('button', { name: /Retired parts \(1\)/ })).toBeInTheDocument();
      expect(c.getByText('Cassette · Old', { selector: 'td' }).closest('.MuiCollapse-root')).toHaveClass('MuiCollapse-hidden');
    });
    test('the retired section expands to show final wear and dates', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(screen.getByRole('button', { name: /Retired parts/ }));
      const row = (await screen.findByText('Cassette · Old')).closest('tr');
      expect(within(row).getByText('2100 km')).toBeInTheDocument();
      expect(within(row).getByText(/Mar 2025/)).toBeInTheDocument();
    });
    test('with no parts, it invites the user to add some', async () => {
      setup(detail({ components: [] }));
      expect(await screen.findByText(/No active components/)).toBeInTheDocument();
      expect(screen.queryByText(/Retired parts/)).not.toBeInTheDocument();
    });
    test('"Add component" opens the form with this bike preselected', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
      expect(await screen.findByText('Add component', { selector: 'h2' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Bike/ })).toHaveTextContent('Gravel');
    });
    test('"Replace" opens the service form for that part, already set to a replacement', async () => {
      const m = setup(detail(), { 'POST /services': () => ({ id: 1, retiredComponentId: 10, newComponent: component({ id: 30, type: 'CHAIN' }) }) });
      await screen.findByRole('heading', { name: 'Gravel' });
      const row = within(section('Components')).getByText('Chain · KMC X11').closest('div').parentElement;
      await userEvent.click(within(row).getByRole('button', { name: /Replace/ }));
      expect(await screen.findByText('Log service', { selector: 'h2' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Service type/ })).toHaveTextContent('Replacement');
      await waitFor(() => expect(screen.getByRole('combobox', { name: /^Component/ })).toHaveTextContent(/Chain/));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Mount a new part' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Chain retired, new chain mounted')).toBeInTheDocument();
      expect(m.called('POST', '/services')[0].body).toMatchObject({ bikeId: '1', componentId: '10', type: 'REPLACE' });
      await waitFor(() => expect(m.called('GET', '/bikes/1')).toHaveLength(2)); // page refreshed
    });
    test('editing and deleting a part', async () => {
      const m = setup(detail(), { 'PUT /components/11': (c) => ({ id: 11, ...c.body }), 'DELETE /components/11': null });
      await screen.findByRole('heading', { name: 'Gravel' });
      const row = () => within(section('Components')).getByText('Rear tyre · Schwalbe').closest('div').parentElement;
      await userEvent.click(within(row()).getByRole('button', { name: 'Edit' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
      await waitFor(() => expect(m.called('PUT', '/components/11')).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await userEvent.click(within(row()).getByRole('button', { name: 'Delete' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(m.called('DELETE', '/components/11')).toHaveLength(1));
    });
  });

  describe('buying a replacement', () => {
    test('every active part has a buy menu that knows the bike type', async () => {
      setup(detail({ type: 'GRAVEL', components: [component({ id: 11, type: 'TYRE_REAR', brand: null, model: null, status: 'OK' })] }));
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(within(section('Components')).getByRole('button', { name: 'Buy a replacement' }));
      expect(await screen.findByText('Search for “rear tyre gravel bike”')).toBeInTheDocument();
    });
    test('the wear bars show the expected limit date', async () => {
      setup(detail({ components: [component({ id: 11, forecast: { status: 'DATE', date: '2026-12-14', daysLeft: 90, kmPerDay: 4, windowDays: 90, remainingKm: 360 } })] }));
      expect(await screen.findByText(/Limit expected 14 Dec 2026/)).toBeInTheDocument();
    });
  });

  describe('moving parts and their history', () => {
    test('every active part has History and Move buttons when there is another bike', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      expect(within(section('Components')).getAllByRole('button', { name: 'Part history' })).toHaveLength(2);
      expect(within(section('Components')).getAllByRole('button', { name: 'Move to another bike' })).toHaveLength(2);
    });
    test('with a single bike there is nothing to move to', async () => {
      setup(detail(), { 'GET /bikes': [bike({ id: 1, name: 'Gravel' })] });
      await screen.findByRole('heading', { name: 'Gravel' });
      expect(screen.queryByRole('button', { name: 'Move to another bike' })).not.toBeInTheDocument();
      expect(within(section('Components')).getAllByRole('button', { name: 'Part history' }).length).toBeGreaterThan(0);
    });
    test('Move opens the dialog for that part, moves it and refreshes the page', async () => {
      const m = setup(detail(), { 'POST /components/10/move': () => ({ ...chain, bikeId: 2, bikeName: 'Commuter' }) });
      await screen.findByRole('heading', { name: 'Gravel' });
      const row = within(section('Components')).getByText('Chain · KMC X11').closest('div').parentElement;
      await userEvent.click(within(row).getByRole('button', { name: 'Move to another bike' }));
      expect(await screen.findByText('Move to another bike', { selector: 'h2' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('combobox', { name: /Move to/ }));
      await userEvent.click(await screen.findByRole('option', { name: 'Commuter' }));
      await userEvent.click(screen.getByRole('button', { name: 'Move' }));
      expect(await screen.findByText('Moved to Commuter')).toBeInTheDocument();
      expect(m.called('POST', '/components/10/move')[0].body.bikeId).toBe('2');
      await waitFor(() => expect(m.called('GET', '/bikes/1')).toHaveLength(2));
    });
    test('History opens the mount history of that part', async () => {
      setup(detail(), { 'GET /components/10': { ...chain, wearKm: 3430, maxKm: 4000, installedAt: '2025-01-01', mounts: [{ id: 1, bikeId: 1, bikeName: 'Gravel', fromDate: '2025-01-01', toDate: null, km: 3430 }], services: [] } });
      await screen.findByRole('heading', { name: 'Gravel' });
      const row = within(section('Components')).getByText('Chain · KMC X11').closest('div').parentElement;
      await userEvent.click(within(row).getByRole('button', { name: 'Part history' }));
      expect(await screen.findByText('History: Chain · KMC X11')).toBeInTheDocument();
      expect(await screen.findByText('Now')).toBeInTheDocument();
    });
  });

  describe('maintenance schedule', () => {
    test('the bike page includes the maintenance schedule for this bike', async () => {
      const m = setup(detail(), { 'GET /maintenance/rules': [rule({ title: 'Clean and lube the chain', status: 'DUE' })] });
      expect(await screen.findByText('Maintenance schedule')).toBeInTheDocument();
      expect(await screen.findByText('Clean and lube the chain')).toBeInTheDocument();
      expect(m.called('GET', '/maintenance/rules')[0].query).toEqual({ bikeId: '1' });
    });
    test('marking a rule done also refreshes the bike (a service was logged)', async () => {
      const r = rule({ id: 3, title: 'Clean and lube the chain', status: 'DUE' });
      const m = setup(detail(), { 'GET /maintenance/rules': [r], 'POST /maintenance/rules/3/complete': { service: { id: 1 }, rule: r } });
      await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
      await waitFor(() => expect(m.called('GET', '/bikes/1')).toHaveLength(2));
    });
  });

  describe('rides', () => {
    test('shows the recent rides with date, title, distance, duration and source', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      const rides = within(section('Recent rides'));
      expect(rides.getByText('Morning ride')).toBeInTheDocument();
      expect(rides.getByText('42.5 km')).toBeInTheDocument();
      expect(rides.getByText('1:35')).toBeInTheDocument();
      expect(rides.getByText('Manual')).toBeInTheDocument();
      expect(rides.getByText('GPX')).toBeInTheDocument();
      expect(rides.getByRole('link', { name: 'All rides' })).toHaveAttribute('href', '/rides');
    });
    test('no rides yet', async () => {
      setup(detail({ recentRides: [] }));
      expect(await screen.findByText('No rides logged yet.')).toBeInTheDocument();
    });
    test('"Add ride" opens the form for this bike; "Import GPX" opens the importer', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(within(section('Recent rides')).getByRole('button', { name: 'Add ride' }));
      expect(await screen.findByText('Add ride', { selector: 'h2' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByText('Add ride', { selector: 'h2' })).not.toBeInTheDocument());
      await userEvent.click(within(section('Recent rides')).getByRole('button', { name: 'Import GPX' }));
      expect(await screen.findByText('Import a ride from a file')).toBeInTheDocument();
    });
    test('deleting a ride asks first, then refreshes the page', async () => {
      const m = setup(detail(), { 'DELETE /rides/5': null });
      await screen.findByRole('heading', { name: 'Gravel' });
      const row = screen.getByText('Morning ride').closest('tr');
      await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));
      expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(m.called('DELETE', '/rides/5')).toHaveLength(1));
      expect(await screen.findByText('Deleted')).toBeInTheDocument();
      await waitFor(() => expect(m.called('GET', '/bikes/1')).toHaveLength(2));
    });
  });

  describe('services', () => {
    test('shows type, part, cost and notes; missing values appear as dashes', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      const rows = within(section('Service history')).getAllByRole('row').slice(1);
      expect(within(rows[0]).getByText('Replacement')).toBeInTheDocument();
      expect(within(rows[0]).getByText('Chain · KMC X11')).toBeInTheDocument();
      expect(within(rows[0]).getByText(/RON\s?120\.00/)).toBeInTheDocument();
      expect(within(rows[0]).getByText('New chain')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Cleaning')).toBeInTheDocument();
      expect(within(rows[1]).getAllByText('–').length).toBeGreaterThanOrEqual(2);
    });
    test('"Log service" opens the form for this bike', async () => {
      setup();
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(screen.getByRole('button', { name: 'Log service' }));
      expect(await screen.findByText('Log service', { selector: 'h2' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Bike/ })).toHaveTextContent('Gravel');
    });
    test('no services yet', async () => {
      setup(detail({ recentServices: [] }));
      expect(await screen.findByText('No services logged yet.')).toBeInTheDocument();
    });
    test('deleting a service', async () => {
      const m = setup(detail(), { 'DELETE /services/7': null });
      await screen.findByRole('heading', { name: 'Gravel' });
      const row = screen.getByText('New chain').closest('tr');
      await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(m.called('DELETE', '/services/7')).toHaveLength(1));
    });
  });

  describe('bike actions', () => {
    test('Edit changes the bike and refreshes', async () => {
      const m = setup(detail(), { 'PUT /bikes/1': (c) => ({ id: 1, ...c.body }) });
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]); // the bike's own Edit button comes first
      expect(await screen.findByLabelText(/^Name/)).toHaveValue('Gravel');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(m.called('PUT', '/bikes/1')).toHaveLength(1));
      await waitFor(() => expect(m.called('GET', '/bikes/1')).toHaveLength(2));
    });
    test('Delete warns about everything that goes with the bike and then returns to the list', async () => {
      const m = setup(detail(), { 'DELETE /bikes/1': null });
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
      expect(screen.getByText(/"Gravel" and everything on it will be permanently deleted/)).toBeInTheDocument();
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(m.called('DELETE', '/bikes/1')).toHaveLength(1));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/bikes'));
    });
    test('a failed delete shows the error', async () => {
      setup(detail(), { 'DELETE /rides/5': fail(500, { error: 'Internal server error' }) });
      await screen.findByRole('heading', { name: 'Gravel' });
      await userEvent.click(within(screen.getByText('Morning ride').closest('tr')).getByRole('button', { name: 'Delete' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
      expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    });
  });
});
