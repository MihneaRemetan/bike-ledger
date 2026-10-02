import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BikeFormDialog, ComponentFormDialog, RideFormDialog, ServiceFormDialog } from '../../components/forms';
import { renderWithProviders, mockApi, fail, bike, component, ride, service } from '../../test/utils';

const bikes = [bike({ id: 1, name: 'Gravel' }), bike({ id: 2, name: 'Commuter' })];
const choose = async (label, option) => {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

describe('BikeFormDialog', () => {
  test('creates a bike: sends the form, confirms with a message and reports the saved bike', async () => {
    const m = mockApi({ 'POST /bikes': (c) => ({ id: 9, ...c.body }) });
    const onSaved = vi.fn();
    renderWithProviders(<BikeFormDialog open onClose={() => {}} onSaved={onSaved} />);
    expect(screen.getByText('Add bike')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Name/), 'Roadie');
    await choose(/^Type/, 'Road');
    await userEvent.type(screen.getByLabelText(/^Year/), '2021');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 9, name: 'Roadie' })));
    expect(m.called('POST', '/bikes')[0].body).toMatchObject({ name: 'Roadie', type: 'ROAD', year: '2021' });
    expect(await screen.findByText('Bike added')).toBeInTheDocument();
  });
  test('the type defaults to Gravel', async () => {
    const m = mockApi({ 'POST /bikes': (c) => c.body });
    renderWithProviders(<BikeFormDialog open onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('POST', '/bikes')).toHaveLength(1));
    expect(m.called('POST', '/bikes')[0].body.type).toBe('GRAVEL');
  });
  test('edits an existing bike with PUT and prefilled values', async () => {
    const m = mockApi({ 'PUT /bikes/1': (c) => ({ id: 1, ...c.body }) });
    renderWithProviders(<BikeFormDialog open bike={bike({ id: 1, name: 'Old name', year: 2020 })} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Edit bike')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Old name');
    await userEvent.clear(screen.getByLabelText(/^Name/));
    await userEvent.type(screen.getByLabelText(/^Name/), 'New name');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/bikes/1')).toHaveLength(1));
    expect(m.called('PUT', '/bikes/1')[0].body.name).toBe('New name');
    expect(await screen.findByText('Bike updated')).toBeInTheDocument();
  });
  test('server validation errors show under the fields and nothing is reported as saved', async () => {
    mockApi({ 'POST /bikes': fail(400, { error: 'Validation failed', details: [{ field: 'name', message: 'Name is required' }] }) });
    const onSaved = vi.fn();
    renderWithProviders(<BikeFormDialog open onClose={() => {}} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('ComponentFormDialog', () => {
  const defaults = { CHAIN: 4000, CASSETTE: 12000, BRAKE_PADS: 2500 };
  const routes = (extra = {}) => ({ 'GET /components/defaults': defaults, ...extra });

  test('a new part starts as a chain with the suggested limit and today as install date', async () => {
    mockApi(routes());
    renderWithProviders(<ComponentFormDialog open bikes={bikes} defaultBikeId={2} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(4000));
    expect(screen.getByLabelText(/^Installed on/)).toHaveValue(new Date().toISOString().slice(0, 10));
    expect(screen.getByRole('combobox', { name: /Bike/ })).toHaveTextContent('Commuter');
    expect(screen.queryByLabelText(/^Retired on/)).not.toBeInTheDocument();
  });
  test('changing the type updates the suggested limit until the user types their own', async () => {
    mockApi(routes());
    renderWithProviders(<ComponentFormDialog open bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(4000));
    await choose(/^Type/, 'Cassette');
    expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(12000);
    await userEvent.clear(screen.getByLabelText(/^Wear limit/));
    await userEvent.type(screen.getByLabelText(/^Wear limit/), '9000');
    await choose(/^Type/, 'Brake pads');
    expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(9000);
  });
  test('creates the part with the chosen bike', async () => {
    const m = mockApi(routes({ 'POST /components': (c) => ({ id: 3, ...c.body }) }));
    const onSaved = vi.fn();
    renderWithProviders(<ComponentFormDialog open bikes={bikes} defaultBikeId={1} onClose={() => {}} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(4000));
    await userEvent.type(screen.getByLabelText(/^Brand/), 'KMC');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(m.called('POST', '/components')[0].body).toMatchObject({ bikeId: '1', type: 'CHAIN', brand: 'KMC', maxKm: 4000 });
    expect(await screen.findByText('Component added')).toBeInTheDocument();
  });
  test('editing keeps the stored limit when the type changes and can set a retirement date', async () => {
    const m = mockApi(routes({ 'PUT /components/10': (c) => ({ id: 10, ...c.body }) }));
    renderWithProviders(<ComponentFormDialog open component={component({ maxKm: 3500 })} bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Edit component')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(3500);
    await choose(/^Type/, 'Cassette');
    expect(screen.getByLabelText(/^Wear limit/)).toHaveValue(3500);
    await userEvent.type(screen.getByLabelText(/^Retired on/), '2025-06-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/components/10')).toHaveLength(1));
    expect(m.called('PUT', '/components/10')[0].body).toMatchObject({ type: 'CASSETTE', maxKm: 3500, retiredAt: '2025-06-01' });
    expect(await screen.findByText('Component updated')).toBeInTheDocument();
  });
  test('shows server errors such as an invalid retirement date', async () => {
    mockApi(routes({ 'PUT /components/10': fail(400, { error: 'Validation failed', details: [{ field: 'retiredAt', message: 'Retired date cannot be before installed date' }] }) }));
    renderWithProviders(<ComponentFormDialog open component={component()} bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Retired date cannot be before installed date')).toBeInTheDocument();
  });
});

describe('RideFormDialog', () => {
  test('creates a ride for the preselected bike', async () => {
    const m = mockApi({ 'POST /rides': (c) => ({ id: 1, ...c.body }) });
    const onSaved = vi.fn();
    renderWithProviders(<RideFormDialog open bikes={bikes} defaultBikeId={1} onClose={() => {}} onSaved={onSaved} />);
    expect(screen.getByText('Add ride')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Distance/), '42.5');
    await userEvent.type(screen.getByLabelText(/^Title/), 'Sunday');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = m.called('POST', '/rides')[0].body;
    expect(body).toMatchObject({ bikeId: '1', distanceKm: '42.5', title: 'Sunday' });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await screen.findByText('Ride added')).toBeInTheDocument();
  });
  test('edits an existing ride', async () => {
    const m = mockApi({ 'PUT /rides/5': (c) => ({ id: 5, ...c.body }) });
    renderWithProviders(<RideFormDialog open ride={ride()} bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Edit ride')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Distance/)).toHaveValue(42.5);
    expect(screen.getByLabelText(/^Duration/)).toHaveValue(95);
    await userEvent.clear(screen.getByLabelText(/^Distance/));
    await userEvent.type(screen.getByLabelText(/^Distance/), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/rides/5')).toHaveLength(1));
    expect(m.called('PUT', '/rides/5')[0].body.distanceKm).toBe('50');
    expect(await screen.findByText('Ride updated')).toBeInTheDocument();
  });
  test('distance errors from the server show under the field', async () => {
    mockApi({ 'POST /rides': fail(400, { error: 'Validation failed', details: [{ field: 'distanceKm', message: 'Max 2000 km' }] }) });
    renderWithProviders(<RideFormDialog open bikes={bikes} defaultBikeId={1} onClose={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^Distance/), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Max 2000 km')).toBeInTheDocument();
  });
});

describe('ServiceFormDialog', () => {
  const parts = [
    component({ id: 10, bikeId: 1, type: 'CHAIN', brand: 'KMC' }),
    component({ id: 11, bikeId: 1, type: 'TYRE_REAR', brand: 'Schwalbe' }),
    component({ id: 12, bikeId: 2, type: 'CABLES', brand: 'Jagwire' }),
    component({ id: 13, bikeId: 1, type: 'CASSETTE', retiredAt: '2024-01-01', brand: 'Old' }),
  ];
  const routes = (extra = {}) => ({ 'GET /components': parts, ...extra });

  test('the part list only offers active parts of the chosen bike', async () => {
    mockApi(routes());
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1 }} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(async () => {
      await userEvent.click(screen.getByLabelText(/^Component/));
      expect(await screen.findByRole('option', { name: /Chain/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /Rear tyre/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Cables/ })).not.toBeInTheDocument(); // other bike
    expect(screen.queryByRole('option', { name: /Cassette/ })).not.toBeInTheDocument(); // retired
  });
  test('switching bike clears the selected part', async () => {
    mockApi(routes());
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1, componentId: 10, type: 'REPLACE' }} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/^Component/)).toHaveTextContent(/Chain/));
    await choose(/^Bike/, 'Commuter');
    expect(screen.getByLabelText(/^Component/)).not.toHaveTextContent(/Chain/);
  });
  test('a plain service is logged with the date and a simple confirmation', async () => {
    const m = mockApi(routes({ 'POST /services': (c) => ({ id: 1, ...c.body }) }));
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1 }} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Log service')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Date/)).toHaveValue(new Date().toISOString().slice(0, 10));
    await userEvent.type(screen.getByLabelText(/^Cost/), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('POST', '/services')).toHaveLength(1));
    const body = m.called('POST', '/services')[0].body;
    expect(body).toMatchObject({ bikeId: '1', type: 'CLEAN', cost: '25' });
    expect('replacement' in body).toBe(false);
    expect(await screen.findByText('Service logged')).toBeInTheDocument();
  });
  test('"Mount a new part" only exists for a replacement of a chosen part', async () => {
    mockApi(routes());
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1 }} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByRole('checkbox', { name: 'Mount a new part' })).not.toBeInTheDocument();
    await choose(/^Service type/, 'Replacement');
    expect(screen.queryByRole('checkbox', { name: 'Mount a new part' })).not.toBeInTheDocument(); // no part yet
  });
  test('the replace shortcut preselects the part and opens the new-part fields on demand', async () => {
    mockApi(routes());
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1, componentId: 10, type: 'REPLACE' }} onClose={() => {}} onSaved={() => {}} />);
    const mount = await screen.findByRole('checkbox', { name: 'Mount a new part' });
    expect(screen.queryByLabelText(/^New part brand/)).not.toBeInTheDocument();
    await userEvent.click(mount);
    for (const l of [/^New part brand/, /^New part model/, /^New part wear limit/, /^New part price/]) expect(screen.getByLabelText(l)).toBeInTheDocument();
  });
  test('replacing with a new part sends the replacement and confirms "Chain retired, new chain mounted"', async () => {
    const m = mockApi(routes({ 'POST /services': () => ({ id: 1, retiredComponentId: 10, newComponent: component({ id: 20, type: 'CHAIN' }) }) }));
    const onSaved = vi.fn();
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1, componentId: 10, type: 'REPLACE' }} onClose={() => {}} onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mount a new part' }));
    await userEvent.type(screen.getByLabelText(/^New part brand/), 'Shimano');
    await userEvent.type(screen.getByLabelText(/^New part wear limit/), '5000');
    await userEvent.type(screen.getByLabelText(/^New part price/), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(m.called('POST', '/services')[0].body).toMatchObject({
      bikeId: '1', componentId: '10', type: 'REPLACE',
      replacement: { brand: 'Shimano', model: '', maxKm: '5000', price: '120' },
    });
    expect(await screen.findByText('Chain retired, new chain mounted')).toBeInTheDocument();
  });
  test('the confirmation names the actual part type', async () => {
    mockApi(routes({ 'POST /services': () => ({ id: 1, retiredComponentId: 11, newComponent: component({ id: 21, type: 'TYRE_REAR' }) }) }));
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1, componentId: 11, type: 'REPLACE' }} onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mount a new part' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Rear tyre retired, new rear tyre mounted')).toBeInTheDocument();
  });
  test('replacing without a new part only retires the old one', async () => {
    const m = mockApi(routes({ 'POST /services': () => ({ id: 1, retiredComponentId: 10, newComponent: null }) }));
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1, componentId: 10, type: 'REPLACE' }} onClose={() => {}} onSaved={() => {}} />);
    await screen.findByRole('checkbox', { name: 'Mount a new part' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Chain retired')).toBeInTheDocument();
    expect('replacement' in m.called('POST', '/services')[0].body).toBe(false);
  });
  test('errors on the new part fields are shown under the matching inputs', async () => {
    mockApi(routes({ 'POST /services': fail(400, { error: 'Validation failed', details: [{ field: 'replacement.maxKm', message: 'Must be greater than 0' }] }) }));
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1, componentId: 10, type: 'REPLACE' }} onClose={() => {}} onSaved={() => {}} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mount a new part' }));
    await userEvent.type(screen.getByLabelText(/^New part wear limit/), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const field = await screen.findByText('Must be greater than 0');
    expect(field.closest('.MuiFormControl-root')).toContainElement(screen.getByLabelText(/^New part wear limit/));
  });
  test('editing a service uses PUT, prefilled values, and offers no "mount a new part"', async () => {
    const m = mockApi(routes({ 'PUT /services/7': (c) => ({ id: 7, ...c.body }) }));
    renderWithProviders(<ServiceFormDialog open service={service({ type: 'REPLACE' })} bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Edit service')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Cost/)).toHaveValue(25);
    expect(screen.queryByRole('checkbox', { name: 'Mount a new part' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/^Cost/));
    await userEvent.type(screen.getByLabelText(/^Cost/), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/services/7')).toHaveLength(1));
    expect(m.called('PUT', '/services/7')[0].body.cost).toBe('30');
    expect(await screen.findByText('Service updated')).toBeInTheDocument();
  });
  test('the part list survives a failing /components request', async () => {
    mockApi({ 'GET /components': fail(500, { error: 'x' }) });
    renderWithProviders(<ServiceFormDialog open bikes={bikes} preset={{ bikeId: 1 }} onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByText('Log service')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText(/^Component/)).toBeInTheDocument();
  });
});
