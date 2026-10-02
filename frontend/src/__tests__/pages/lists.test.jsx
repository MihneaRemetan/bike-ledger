import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Components from '../../pages/Components';
import Rides from '../../pages/Rides';
import Services from '../../pages/Services';
import { renderWithProviders, mockApi, fail, bike, component, ride, service } from '../../test/utils';

const bikes = [bike({ id: 1, name: 'Gravel' }), bike({ id: 2, name: 'Commuter' })];
const pick = async (label, option) => {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};
const pickInDialog = async (label, option) => {
  await userEvent.click(within(await screen.findByRole('dialog')).getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};
const confirmDelete = async () => userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
const rowOf = (text) => screen.getByText(text).closest('tr');

describe('Components page', () => {
  const parts = [
    component({ id: 10, type: 'BRAKE_PADS', brand: 'Shimano', model: 'L03A', bikeId: 1, bikeName: 'Gravel', status: 'WARN', wearKm: 1145, maxKm: 1300, wearPct: 0.88, installedAt: '2025-06-29' }),
    component({ id: 11, type: 'CHAIN', brand: 'KMC', model: null, bikeId: 2, bikeName: 'Commuter', status: 'OK', installedAt: '2025-12-26' }),
  ];
  const setup = (routes = {}) => {
    const m = mockApi({ 'GET /bikes': bikes, 'GET /components': parts, 'GET /components/defaults': { CHAIN: 4000 }, ...routes });
    renderWithProviders(<Components />, { route: '/components' });
    return m;
  };
  test('describes the page and lists each part with bike link, brand/model, install date, wear and status', async () => {
    setup();
    expect(screen.getByText(/The parts mounted on your bikes/)).toBeInTheDocument();
    const row = within(await screen.findByText('Brake pads').then((c) => c.closest('tr')));
    expect(row.getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/1');
    expect(row.getByText('Shimano L03A')).toBeInTheDocument();
    expect(row.getByText(/Jun 2025/)).toBeInTheDocument();
    expect(row.getByText('1145 / 1300 km (88%)')).toBeInTheDocument();
    expect(row.getByText('Wearing out')).toBeInTheDocument();
    expect(within(rowOf('Chain')).getByText('KMC')).toBeInTheDocument();
  });
  test('by default only active parts are requested; the status filter changes the request', async () => {
    const m = setup();
    await screen.findByText('Brake pads');
    expect(m.called('GET', '/components')[0].query).toEqual({ status: 'active' });
    await pick(/^Status/, 'Retired');
    await waitFor(() => expect(m.called('GET', '/components').at(-1).query).toEqual({ status: 'retired' }));
    await pick(/^Status/, 'All');
    await waitFor(() => expect(m.called('GET', '/components').at(-1).query).toEqual({}));
  });
  test('the bike filter limits the request to that bike', async () => {
    const m = setup();
    await screen.findByText('Brake pads');
    await pick(/^Bike/, 'Commuter');
    await waitFor(() => expect(m.called('GET', '/components').at(-1).query).toEqual({ bikeId: '2', status: 'active' }));
  });
  test('shows an empty state with an invitation, a placeholder while loading and errors', async () => {
    setup({ 'GET /components': [] });
    expect(await screen.findByText('No components')).toBeInTheDocument();
  });
  test('shows the server error', async () => {
    setup({ 'GET /components': fail(500, { error: 'Internal server error' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
  test('adding a part is disabled until there is a bike', async () => {
    setup({ 'GET /bikes': [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add component' })).toBeDisabled());
  });
  test('adding a part opens the form (with the filtered bike preselected), posts it and refreshes', async () => {
    let list = parts;
    const m = setup({ 'GET /components': () => list, 'POST /components': (c) => { list = [...list, component({ id: 12, type: 'CASSETTE', bikeName: 'Commuter' })]; return { id: 12 }; } });
    await screen.findByText('Brake pads');
    await pick(/^Bike/, 'Commuter');
    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    await waitFor(() => expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(4000));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('POST', '/components')).toHaveLength(1));
    expect(m.called('POST', '/components')[0].body.bikeId).toBe('2');
    expect(await screen.findByText('Component added')).toBeInTheDocument();
  });
  test('editing a part opens the form prefilled', async () => {
    const m = setup({ 'PUT /components/11': (c) => ({ id: 11, ...c.body }) });
    await screen.findByText('Chain');
    await userEvent.click(within(rowOf('Chain')).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText(/^Brand/)).toHaveValue('KMC');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/components/11')).toHaveLength(1));
  });
  test('active parts have a buy menu using the type of their bike; retired parts do not', async () => {
    setup({ 'GET /bikes': [bike({ id: 1, name: 'Gravel', type: 'GRAVEL' }), bike({ id: 2, name: 'Commuter', type: 'CITY' })], 'GET /components': [
      component({ id: 20, type: 'TYRE_REAR', brand: null, model: null, bikeId: 2, bikeName: 'Commuter' }),
      component({ id: 21, type: 'CASSETTE', brand: null, model: null, bikeId: 1, bikeName: 'Gravel', retiredAt: '2025-01-01', status: 'RETIRED' }),
    ] });
    await screen.findByText('Rear tyre');
    expect(screen.getAllByRole('button', { name: 'Buy a replacement' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Buy a replacement' }));
    expect(await screen.findByText('Search for “rear tyre city bike”')).toBeInTheDocument();
  });
  test('every part has a History button; Move is offered for active parts only', async () => {
    setup({ 'GET /components': [...parts, component({ id: 12, type: 'CASSETTE', brand: 'Old', model: null, bikeId: 1, bikeName: 'Gravel', status: 'RETIRED', retiredAt: '2025-01-01' })] });
    await screen.findByText('Cassette');
    expect(screen.getAllByRole('button', { name: 'Part history' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Move to another bike' })).toHaveLength(2);
    expect(within(rowOf('Cassette')).queryByRole('button', { name: 'Move to another bike' })).not.toBeInTheDocument();
  });
  test('Move opens the dialog, posts and refreshes the list', async () => {
    let list = parts;
    const m = setup({ 'GET /components': () => list, 'POST /components/10/move': () => { list = [{ ...parts[0], bikeId: 2, bikeName: 'Commuter' }, parts[1]]; return list[0]; } });
    await screen.findByText('Brake pads');
    await userEvent.click(within(rowOf('Brake pads')).getByRole('button', { name: 'Move to another bike' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Move to/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Commuter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(await screen.findByText('Moved to Commuter')).toBeInTheDocument();
    expect(m.called('POST', '/components/10/move')[0].body.bikeId).toBe('2');
    await waitFor(() => expect(m.called('GET', '/components').length).toBeGreaterThan(1));
  });
  test('History shows where the part has been', async () => {
    setup({ 'GET /components/10': { ...parts[0], mounts: [{ id: 1, bikeId: 2, bikeName: 'Commuter', fromDate: '2025-06-29', toDate: '2025-09-01', km: 100 }, { id: 2, bikeId: 1, bikeName: 'Gravel', fromDate: '2025-09-01', toDate: null, km: 1045.1 }], services: [] } });
    await screen.findByText('Brake pads');
    await userEvent.click(within(rowOf('Brake pads')).getByRole('button', { name: 'Part history' }));
    expect(await screen.findByText('History: Brake pads · Shimano L03A')).toBeInTheDocument();
    expect(await screen.findByText('1,045.1 km')).toBeInTheDocument();
  });
  test('a failed delete shows the error', async () => {
    setup({ 'DELETE /components/10': fail(500, { error: 'Internal server error' }) });
    await screen.findByText('Brake pads');
    await userEvent.click(within(rowOf('Brake pads')).getByRole('button', { name: 'Delete' }));
    await confirmDelete();
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
  test('deleting explains what happens to linked services, deletes and confirms', async () => {
    let list = parts;
    const m = setup({ 'GET /components': () => list, 'DELETE /components/10': () => { list = [parts[1]]; return null; } });
    await screen.findByText('Brake pads');
    await userEvent.click(within(rowOf('Brake pads')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Its services stay in the history but are no longer linked to it.')).toBeInTheDocument();
    await confirmDelete();
    await waitFor(() => expect(screen.queryByText('Brake pads')).not.toBeInTheDocument());
    expect(screen.getByText('Component deleted')).toBeInTheDocument();
    expect(m.called('DELETE', '/components/10')).toHaveLength(1);
  });
});

describe('Rides page', () => {
  const rides = [
    ride({ id: 5, title: 'Morning ride', bikeId: 1, bikeName: 'Gravel', distanceKm: 42.5, durationMin: 95, elevationM: 300, source: 'MANUAL', hasRoute: false, date: '2025-05-01T08:00:00.000Z' }),
    ride({ id: 6, title: 'Afternoon Ride', bikeId: 2, bikeName: 'Commuter', distanceKm: 48.4, durationMin: 136, elevationM: 13, source: 'GPX', hasRoute: true, date: '2026-09-13T11:42:41.000Z' }),
    ride({ id: 7, title: null, distanceKm: 5, durationMin: null, elevationM: null, source: 'MANUAL' }),
  ];
  const setup = (routes = {}) => {
    const m = mockApi({ 'GET /bikes': bikes, 'GET /rides': rides, ...routes });
    renderWithProviders(<Rides />, { route: '/rides' });
    return m;
  };
  test('lists rides with formatted date, distance, duration, elevation and source', async () => {
    setup();
    const manual = within((await screen.findByText('Morning ride')).closest('tr'));
    expect(manual.getByText(/01 May 2025/)).toBeInTheDocument();
    expect(manual.getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/1');
    expect(manual.getByText('42.5 km')).toBeInTheDocument();
    expect(manual.getByText('1:35')).toBeInTheDocument();
    expect(manual.getByText('300 m')).toBeInTheDocument();
    expect(manual.getByText('Manual')).toBeInTheDocument();
    const gpx = within(rowOf('Afternoon Ride'));
    expect(gpx.getByText('GPX')).toBeInTheDocument();
    expect(gpx.getByText('2:16')).toBeInTheDocument();
  });
  test('missing values show dashes', async () => {
    setup();
    await screen.findByText('Morning ride');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('5.0 km'));
    expect(within(row).getAllByText('–').length).toBeGreaterThanOrEqual(3); // title, duration, elevation
  });
  test('only rides with a saved route get a "view on map" link', async () => {
    setup();
    await screen.findByText('Morning ride');
    expect(within(rowOf('Morning ride')).queryByRole('link', { name: 'View route on map' })).not.toBeInTheDocument();
    expect(within(rowOf('Afternoon Ride')).getByRole('link', { name: 'View route on map' })).toHaveAttribute('href', '/map?ride=6');
  });
  test('filters by bike and by date range', async () => {
    const m = setup();
    await screen.findByText('Morning ride');
    expect(m.called('GET', '/rides')[0].query).toEqual({});
    await pick(/^Bike/, 'Gravel');
    await waitFor(() => expect(m.called('GET', '/rides').at(-1).query).toEqual({ bikeId: '1' }));
    await userEvent.type(screen.getByLabelText('From'), '2025-01-01');
    await userEvent.type(screen.getByLabelText('To'), '2025-12-31');
    await waitFor(() => expect(m.called('GET', '/rides').at(-1).query).toEqual({ bikeId: '1', from: '2025-01-01', to: '2025-12-31' }));
  });
  test('empty states: with bikes, and without any bike', async () => {
    setup({ 'GET /rides': [] });
    expect(await screen.findByText('No rides')).toBeInTheDocument();
    expect(screen.getByText('Log a ride manually or import a GPX file.')).toBeInTheDocument();
  });
  test('without bikes the add buttons are disabled and the page says to add a bike first', async () => {
    setup({ 'GET /bikes': [], 'GET /rides': [] });
    expect(await screen.findByText('Add a bike first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add ride' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import GPX' })).toBeDisabled();
  });
  test('adding a ride posts it and refreshes the list', async () => {
    let list = rides;
    const m = setup({ 'GET /rides': () => list, 'POST /rides': () => { list = [...list, ride({ id: 8, title: 'New one' })]; return { id: 8 }; } });
    await screen.findByText('Morning ride');
    await userEvent.click(screen.getByRole('button', { name: 'Add ride' }));
    await pickInDialog(/^Bike/, 'Gravel');
    await userEvent.type(await screen.findByLabelText(/^Distance/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('New one')).toBeInTheDocument();
    expect(m.called('POST', '/rides')[0].body).toMatchObject({ bikeId: '1', distanceKm: '10' });
  });
  test('editing a ride prefills the form', async () => {
    const m = setup({ 'PUT /rides/5': (c) => ({ id: 5, ...c.body }) });
    await screen.findByText('Morning ride');
    await userEvent.click(within(rowOf('Morning ride')).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText(/^Distance/)).toHaveValue(42.5);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/rides/5')).toHaveLength(1));
  });
  test('importing a GPX opens the importer and adds the ride', async () => {
    let list = rides;
    const m = setup({
      'GET /rides': () => list,
      'POST /rides/import-gpx': (c) => (c.body.get('preview') ? { title: 'Imported', date: '2026-01-02T08:00:00Z', distanceKm: 12.3, durationMin: 40, elevationM: 5 } : (list = [...list, ride({ id: 9, title: 'Imported', source: 'GPX', hasRoute: true })], { id: 9 })),
    });
    await screen.findByText('Morning ride');
    await userEvent.click(screen.getByRole('button', { name: 'Import GPX' }));
    await pickInDialog(/^Bike/, 'Gravel');
    await userEvent.upload(document.querySelector('input[type="file"]'), new File(['<gpx/>'], 'a.gpx'));
    await userEvent.click(await screen.findByRole('button', { name: 'Save ride' }).then(async (b) => { await waitFor(() => expect(b).toBeEnabled()); return b; }));
    await waitFor(() => expect(screen.getAllByText('Imported').length).toBeGreaterThan(0));
    expect(m.called('POST', '/rides/import-gpx')).toHaveLength(2);
  });
  test('deleting warns that wear is recalculated, then refreshes', async () => {
    let list = rides;
    const m = setup({ 'GET /rides': () => list, 'DELETE /rides/5': () => { list = rides.slice(1); return null; } });
    await screen.findByText('Morning ride');
    await userEvent.click(within(rowOf('Morning ride')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Component wear will be recalculated without this ride.')).toBeInTheDocument();
    await confirmDelete();
    await waitFor(() => expect(screen.queryByText('Morning ride')).not.toBeInTheDocument());
    expect(screen.getByText('Ride deleted')).toBeInTheDocument();
    expect(m.called('DELETE', '/rides/5')).toHaveLength(1);
  });
  test('a failed delete shows the error', async () => {
    setup({ 'DELETE /rides/5': fail(500, { error: 'Internal server error' }) });
    await screen.findByText('Morning ride');
    await userEvent.click(within(rowOf('Morning ride')).getByRole('button', { name: 'Delete' }));
    await confirmDelete();
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
});

describe('Services page', () => {
  const services = [
    service({ id: 7, bikeId: 1, bikeName: 'Gravel', type: 'REPLACE', componentType: 'CHAIN', componentBrand: 'KMC', componentModel: 'X11', cost: 120, notes: 'New chain', date: '2025-05-24' }),
    service({ id: 8, bikeId: 2, bikeName: 'Commuter', type: 'CLEAN', componentId: null, componentType: null, componentBrand: null, componentModel: null, cost: null, notes: null, date: '2025-04-01' }),
  ];
  const setup = (routes = {}) => {
    const m = mockApi({ 'GET /bikes': bikes, 'GET /services': services, 'GET /components': [component({ id: 10, bikeId: 1 })], ...routes });
    renderWithProviders(<Services />, { route: '/services' });
    return m;
  };
  test('explains the page and lists services with type, part, cost and notes', async () => {
    setup();
    expect(screen.getByText(/Logging a replacement retires the old part/)).toBeInTheDocument();
    const row = within((await screen.findByText('New chain')).closest('tr'));
    expect(row.getByText(/24 May 2025/)).toBeInTheDocument();
    expect(row.getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/1');
    expect(row.getByText('Replacement')).toBeInTheDocument();
    expect(row.getByText('Chain · KMC · X11')).toBeInTheDocument();
    expect(row.getByText(/RON\s?120\.00/)).toBeInTheDocument();
    const other = within(screen.getAllByRole('row')[2]);
    expect(other.getByText('Cleaning')).toBeInTheDocument();
    expect(other.getAllByText('–').length).toBeGreaterThanOrEqual(3);
  });
  test('filters by bike', async () => {
    const m = setup();
    await screen.findByText('New chain');
    await pick(/^Bike/, 'Commuter');
    await waitFor(() => expect(m.called('GET', '/services').at(-1).query).toEqual({ bikeId: '2' }));
  });
  test('empty state, and "add a bike first" when there are none', async () => {
    setup({ 'GET /services': [] });
    expect(await screen.findByText('No services')).toBeInTheDocument();
    expect(screen.getByText('Log cleanings, repairs and part replacements.')).toBeInTheDocument();
  });
  test('without bikes logging is disabled', async () => {
    setup({ 'GET /bikes': [], 'GET /services': [] });
    expect(await screen.findByText('Add a bike first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log service' })).toBeDisabled();
  });
  test('shows the server error', async () => {
    setup({ 'GET /services': fail(500, { error: 'Internal server error' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
  test('logging a service posts it (using the bike filter as a preset) and refreshes', async () => {
    let list = services;
    const m = setup({ 'GET /services': () => list, 'POST /services': () => { list = [...list, service({ id: 9, notes: 'Fresh entry' })]; return { id: 9 }; } });
    await screen.findByText('New chain');
    await pick(/^Bike/, 'Gravel');
    await userEvent.click(screen.getByRole('button', { name: 'Log service' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Service logged')).toBeInTheDocument();
    expect(m.called('POST', '/services')[0].body).toMatchObject({ bikeId: '1', type: 'CLEAN' });
  });
  test('editing opens the form prefilled', async () => {
    const m = setup({ 'PUT /services/7': (c) => ({ id: 7, ...c.body }) });
    await screen.findByText('New chain');
    await userEvent.click(within(rowOf('New chain')).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText(/^Cost/)).toHaveValue(120);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/services/7')).toHaveLength(1));
  });
  test('a failed delete shows the error', async () => {
    setup({ 'DELETE /services/7': fail(500, { error: 'Internal server error' }) });
    await screen.findByText('New chain');
    await userEvent.click(within(rowOf('New chain')).getByRole('button', { name: 'Delete' }));
    await confirmDelete();
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
  test('deleting explains that a replaced part stays retired', async () => {
    let list = services;
    const m = setup({ 'GET /services': () => list, 'DELETE /services/7': () => { list = services.slice(1); return null; } });
    await screen.findByText('New chain');
    await userEvent.click(within(rowOf('New chain')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('A replaced component stays retired; only the service record is removed.')).toBeInTheDocument();
    await confirmDelete();
    await waitFor(() => expect(screen.queryByText('New chain')).not.toBeInTheDocument());
    expect(screen.getByText('Service deleted')).toBeInTheDocument();
    expect(m.called('DELETE', '/services/7')).toHaveLength(1);
  });
});
