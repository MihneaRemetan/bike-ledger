import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Bikes from '../../pages/Bikes';
import { renderWithProviders, mockApi, fail, bike } from '../../test/utils';

const gravel = bike({ id: 1, name: 'Gravel', brand: 'Canyon', model: 'Grizl', year: 2024, type: 'GRAVEL', totalKm: 4375.1, rideCount: 114, maintenanceCost: 145, alerts: 3 });
const city = bike({ id: 2, name: 'Commuter', brand: 'Btwin', model: 'Elops 520', year: 2021, type: 'CITY', totalKm: 770.7, rideCount: 136, maintenanceCost: 95, alerts: 0 });
const setup = (routes = {}) => {
  const m = mockApi({ 'GET /bikes': [gravel, city], ...routes });
  renderWithProviders(<Bikes />, { route: '/bikes' });
  return m;
};
const card = (name) => screen.getByRole('heading', { name }).closest('.MuiCard-root');

describe('Bikes page', () => {
  test('lists each bike with details, type, distance, rides and cost', async () => {
    setup();
    const g = within(await screen.findByRole('heading', { name: 'Gravel' }).then((h) => h.closest('.MuiCard-root')));
    expect(g.getByText('Canyon · Grizl · 2024')).toBeInTheDocument();
    expect(g.getByText('Gravel', { selector: '.MuiChip-label' })).toBeInTheDocument();
    expect(g.getByText('4,375.1 km')).toBeInTheDocument();
    expect(g.getByText('114')).toBeInTheDocument();
    expect(g.getByText(/RON\s?145\.00/)).toBeInTheDocument();
    expect(within(card('Commuter')).getByText('City')).toBeInTheDocument();
  });
  test('a bike with worn parts shows a warning badge, others do not', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Gravel' });
    expect(within(card('Gravel')).getByText('3 parts need attention')).toBeInTheDocument();
    expect(within(card('Commuter')).queryByText(/need attention/)).not.toBeInTheDocument();
  });
  test('the badge uses the singular for one part', async () => {
    setup({ 'GET /bikes': [bike({ id: 3, name: 'Solo', alerts: 1 })] });
    expect(await screen.findByText('1 part need attention')).toBeInTheDocument();
  });
  test('a bike without details says so', async () => {
    setup({ 'GET /bikes': [bike({ id: 4, name: 'Plain', brand: null, model: null, year: null })] });
    expect(await screen.findByText('No details')).toBeInTheDocument();
  });
  test('shows a placeholder while loading and an error if it fails', async () => {
    mockApi({ 'GET /bikes': () => new Promise(() => {}) });
    const { unmount } = renderWithProviders(<Bikes />);
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /bikes': fail(500, { error: 'Internal server error' }) });
    renderWithProviders(<Bikes />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
  test('an empty list shows an invitation to add the first bike', async () => {
    setup({ 'GET /bikes': [] });
    expect(await screen.findByText('No bikes yet')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Add bike' }).at(-1));
    expect(await screen.findByText('Add bike', { selector: 'h2' })).toBeInTheDocument();
  });
  test('Open goes to the bike page', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Gravel' });
    await userEvent.click(within(card('Commuter')).getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/bikes/2');
  });
  test('adding a bike posts the form and refreshes the list with a confirmation', async () => {
    let list = [gravel];
    const m = setup({ 'GET /bikes': () => list, 'POST /bikes': (c) => { list = [...list, bike({ id: 3, name: c.body.name })]; return { id: 3 }; } });
    await screen.findByRole('heading', { name: 'Gravel' });
    await userEvent.click(screen.getByRole('button', { name: 'Add bike' }));
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Brand new');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Brand new' })).toBeInTheDocument();
    expect(screen.getByText('Bike added')).toBeInTheDocument();
    expect(m.called('GET', '/bikes')).toHaveLength(2);
  });
  test('editing opens the form prefilled and saves with PUT', async () => {
    const m = setup({ 'PUT /bikes/2': (c) => ({ id: 2, ...c.body }) });
    await screen.findByRole('heading', { name: 'Commuter' });
    await userEvent.click(within(card('Commuter')).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByLabelText(/^Name/)).toHaveValue('Commuter');
    expect(screen.getByLabelText(/^Brand/)).toHaveValue('Btwin');
    await userEvent.type(screen.getByLabelText(/^Notes/), 'daily');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/bikes/2')).toHaveLength(1));
    expect(m.called('PUT', '/bikes/2')[0].body.notes).toBe('daily');
  });
  test('deleting asks for confirmation first, and cancelling deletes nothing', async () => {
    const m = setup();
    await screen.findByRole('heading', { name: 'Gravel' });
    await userEvent.click(within(card('Gravel')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete bike?')).toBeInTheDocument();
    expect(screen.getByText(/"Gravel" and all its components, rides and services will be permanently deleted/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(m.called('DELETE', '/bikes/1')).toHaveLength(0);
  });
  test('confirming deletes the bike, refreshes the list and confirms', async () => {
    let list = [gravel, city];
    const m = setup({ 'GET /bikes': () => list, 'DELETE /bikes/1': () => { list = [city]; return null; } });
    await screen.findByRole('heading', { name: 'Gravel' });
    await userEvent.click(within(card('Gravel')).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Gravel' })).not.toBeInTheDocument());
    expect(screen.getByText('Bike deleted')).toBeInTheDocument();
    expect(m.called('DELETE', '/bikes/1')).toHaveLength(1);
  });
  test('a failed delete shows the error and keeps the bike', async () => {
    setup({ 'DELETE /bikes/1': fail(500, { error: 'Internal server error' }) });
    await screen.findByRole('heading', { name: 'Gravel' });
    await userEvent.click(within(card('Gravel')).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    // the confirmation dialog stays open, which hides the page behind it from assistive tech
    expect(screen.getByRole('heading', { name: 'Gravel', hidden: true })).toBeInTheDocument();
  });
});
