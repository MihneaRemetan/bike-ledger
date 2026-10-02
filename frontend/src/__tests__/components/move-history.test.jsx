import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ComponentHistoryDialog from '../../components/ComponentHistoryDialog';
import { MoveComponentDialog, ComponentFormDialog } from '../../components/forms';
import { renderWithProviders, mockApi, fail, bike, component, service } from '../../test/utils';

const bikes = [bike({ id: 1, name: 'Gravel' }), bike({ id: 2, name: 'Commuter' }), bike({ id: 3, name: 'Road' })];
const chain = component({ id: 10, bikeId: 1, bikeName: 'Gravel', type: 'CHAIN', brand: 'KMC', model: 'X11' });

describe('MoveComponentDialog', () => {
  const open = (props = {}) => renderWithProviders(<MoveComponentDialog open component={chain} bikes={bikes} onClose={() => {}} onSaved={() => {}} {...props} />);

  test('offers every bike except the one the part is on, and today as the date', async () => {
    open();
    expect(screen.getByText('Move to another bike')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Moved on/)).toHaveValue(new Date().toISOString().slice(0, 10));
    await userEvent.click(screen.getByRole('combobox', { name: /Move to/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Commuter', 'Road']);
    expect(screen.getByText('Rides from this day count for the new bike')).toBeInTheDocument();
  });
  test('posts the move, confirms with the new bike name and reports the result', async () => {
    const m = mockApi({ 'POST /components/10/move': () => ({ ...chain, bikeId: 2, bikeName: 'Commuter' }) });
    const onSaved = vi.fn();
    open({ onSaved });
    await userEvent.click(screen.getByRole('combobox', { name: /Move to/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Commuter' }));
    await userEvent.clear(screen.getByLabelText(/^Moved on/));
    await userEvent.type(screen.getByLabelText(/^Moved on/), '2026-08-01');
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(m.called('POST', '/components/10/move')[0].body).toEqual({ bikeId: '2', date: '2026-08-01' });
    expect(await screen.findByText('Moved to Commuter')).toBeInTheDocument();
  });
  test('server errors show under the fields', async () => {
    mockApi({ 'POST /components/10/move': fail(400, { error: 'Move date cannot be before the part was mounted on its current bike' }) });
    open();
    await userEvent.click(screen.getByRole('combobox', { name: /Move to/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Road' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Move date cannot be before');
  });
  test('works while the part or bikes are not loaded yet', () => {
    renderWithProviders(<MoveComponentDialog open component={null} bikes={null} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText('Move to another bike')).toBeInTheDocument();
  });
});

describe('ComponentFormDialog bike field', () => {
  test('when editing, the bike cannot be changed here and points to the Move button', () => {
    mockApi({ 'GET /components/defaults': {} });
    renderWithProviders(<ComponentFormDialog open component={chain} bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('combobox', { name: /^Bike/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('To use it on another bike, use the Move button')).toBeInTheDocument();
  });
  test('when creating, the bike can be chosen', () => {
    mockApi({ 'GET /components/defaults': {} });
    renderWithProviders(<ComponentFormDialog open bikes={bikes} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('combobox', { name: /^Bike/ })).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ComponentHistoryDialog', () => {
  const detail = {
    ...chain, wearKm: 2810.1, maxKm: 5100, status: 'OK', installedAt: '2026-01-01', retiredAt: null,
    mounts: [
      { id: 1, bikeId: 2, bikeName: 'Commuter', fromDate: '2026-01-01', toDate: '2026-04-01', km: 410.5 },
      { id: 2, bikeId: 1, bikeName: 'Gravel', fromDate: '2026-04-01', toDate: null, km: 2399.6 },
    ],
    services: [service({ id: 1, type: 'CLEAN', date: '2026-05-01', cost: 20 }), service({ id: 2, type: 'ADJUST', date: '2026-06-01', cost: null })],
  };
  test('shows the part, its total wear, where it was mounted and the services on it', async () => {
    const m = mockApi({ 'GET /components/10': detail });
    renderWithProviders(<ComponentHistoryDialog open component={chain} onClose={() => {}} />);
    expect(screen.getByText('History: Chain · KMC X11')).toBeInTheDocument();
    expect(await screen.findByText(/2810 \/ 5100 km in total/)).toBeInTheDocument();
    expect(m.called('GET', '/components/10')).toHaveLength(1);
    const rows = within(screen.getByText('Mounted on').nextElementSibling).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Commuter')).toBeInTheDocument();
    expect(within(rows[0]).getByText('410.5 km')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Apr 2026/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Gravel')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Cleaning')).toBeInTheDocument();
    expect(screen.getByText('Adjustment')).toBeInTheDocument();
  });
  test('a retired part shows its retirement date instead of "Now"', async () => {
    mockApi({ 'GET /components/10': { ...detail, retiredAt: '2026-09-01', status: 'RETIRED' } });
    renderWithProviders(<ComponentHistoryDialog open component={chain} onClose={() => {}} />);
    expect(await screen.findByText(/retired 01 Sep/)).toBeInTheDocument();
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });
  test('says so when there are no services', async () => {
    mockApi({ 'GET /components/10': { ...detail, services: [] } });
    renderWithProviders(<ComponentHistoryDialog open component={chain} onClose={() => {}} />);
    expect(await screen.findByText('None yet.')).toBeInTheDocument();
  });
  test('shows an error and loads nothing while closed', async () => {
    const m = mockApi({ 'GET /components/10': fail(500, { error: 'Internal server error' }) });
    const { unmount } = renderWithProviders(<ComponentHistoryDialog open={false} component={chain} onClose={() => {}} />);
    expect(m.called('GET', '/components/10')).toHaveLength(0);
    unmount();
    renderWithProviders(<ComponentHistoryDialog open component={chain} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
  test('Close closes', async () => {
    mockApi({ 'GET /components/10': detail });
    const onClose = vi.fn();
    renderWithProviders(<ComponentHistoryDialog open component={chain} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
