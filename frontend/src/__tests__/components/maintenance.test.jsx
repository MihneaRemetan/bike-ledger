import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RuleBar from '../../components/RuleBar';
import StatusChip from '../../components/StatusChip';
import MaintenanceSection from '../../components/MaintenanceSection';
import { RuleFormDialog } from '../../components/forms';
import { renderWithProviders, mockApi, fail, rule, component } from '../../test/utils';

describe('StatusChip for maintenance rules', () => {
  test.each([['OK', 'OK'], ['DUE', 'Due soon'], ['OVERDUE', 'Overdue'], ['PAUSED', 'Paused']])('%s reads "%s"', (status, text) => {
    renderWithProviders(<StatusChip rule status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
  test('part statuses still read as before', () => {
    renderWithProviders(<StatusChip status="WARN" />);
    expect(screen.getByText('Wearing out')).toBeInTheDocument();
  });
});

describe('RuleBar', () => {
  test('shows distance and days when the rule has both, and the status', () => {
    renderWithProviders(<RuleBar rule={rule({ everyKm: 300, kmSince: 186.3, everyDays: 90, daysSince: 30, pct: 0.621, status: 'OK' })} />);
    expect(screen.getByText('186 / 300 km · 30 / 90 days')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
  });
  test('only the intervals that exist are shown', () => {
    const { unmount } = renderWithProviders(<RuleBar rule={rule({ everyKm: 300, everyDays: null })} />);
    expect(screen.getByText('186 / 300 km')).toBeInTheDocument();
    unmount();
    renderWithProviders(<RuleBar rule={rule({ everyKm: null, everyDays: 365, daysSince: 75 })} />);
    expect(screen.getByText('75 / 365 days')).toBeInTheDocument();
  });
  test('the bar caps at 100% for overdue rules and the chip can be hidden', () => {
    renderWithProviders(<RuleBar hideChip rule={rule({ pct: 1.4, status: 'OVERDUE' })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });
});

describe('RuleFormDialog', () => {
  const parts = [component({ id: 10, type: 'CHAIN', brand: 'KMC', model: 'X11' })];
  const open = (props = {}) => renderWithProviders(<RuleFormDialog open bikeId={1} parts={parts} onClose={() => {}} onSaved={() => {}} {...props} />);

  test('a new rule starts as a cleaning rule counting from today', () => {
    open();
    expect(screen.getByText('Add maintenance rule')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Counts as/ })).toHaveTextContent('Cleaning');
    expect(screen.getByLabelText(/^Counting from/)).toHaveValue(new Date().toISOString().slice(0, 10));
    expect(screen.getByText('Set a distance, a number of days, or both')).toBeInTheDocument();
  });
  test('creates the rule for the bike with the typed values', async () => {
    const m = mockApi({ 'POST /maintenance/rules': (c) => ({ id: 9, ...c.body }) });
    const onSaved = vi.fn();
    open({ onSaved });
    await userEvent.type(screen.getByLabelText(/^What needs doing/), 'Lube chain');
    await userEvent.type(screen.getByLabelText(/^Every/), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(m.called('POST', '/maintenance/rules')[0].body).toMatchObject({ bikeId: 1, title: 'Lube chain', serviceType: 'CLEAN', everyKm: '300', everyDays: '' });
    expect(await screen.findByText('Rule added')).toBeInTheDocument();
  });
  test('a rule can be limited to one part of the bike', async () => {
    const m = mockApi({ 'POST /maintenance/rules': (c) => c.body });
    open();
    await userEvent.type(screen.getByLabelText(/^What needs doing/), 'Wax chain');
    await userEvent.type(screen.getByLabelText(/^Or every/), '60');
    await userEvent.click(screen.getByLabelText(/^Only for this part/));
    await userEvent.click(await screen.findByRole('option', { name: 'Chain · KMC X11' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('POST', '/maintenance/rules')).toHaveLength(1));
    expect(m.called('POST', '/maintenance/rules')[0].body).toMatchObject({ componentId: '10', everyDays: '60' });
  });
  test('the server complaint about missing intervals shows under the distance field', async () => {
    mockApi({ 'POST /maintenance/rules': fail(400, { error: 'Validation failed', details: [{ field: 'everyKm', message: 'Set a distance, a number of days, or both' }] }) });
    open();
    await userEvent.type(screen.getByLabelText(/^What needs doing/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const msgs = await screen.findAllByText('Set a distance, a number of days, or both');
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/^Every/)).toBeInvalid();
  });
  test('editing uses PUT and prefilled values', async () => {
    const m = mockApi({ 'PUT /maintenance/rules/3': (c) => ({ id: 3, ...c.body }) });
    open({ rule: rule({ componentId: 10, componentType: 'CHAIN' }) });
    expect(screen.getByText('Edit rule')).toBeInTheDocument();
    expect(screen.getByLabelText(/^What needs doing/)).toHaveValue('Clean and lube the chain');
    expect(screen.getByLabelText(/^Every/)).toHaveValue(300);
    expect(screen.getByLabelText(/^Only for this part/)).toHaveTextContent('Chain · KMC X11');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/maintenance/rules/3')).toHaveLength(1));
    expect(await screen.findByText('Rule updated')).toBeInTheDocument();
  });
});

describe('MaintenanceSection', () => {
  const rules = [
    rule({ id: 1, title: 'Brake and gear adjustment', serviceType: 'ADJUST', status: 'OVERDUE', pct: 1.13, kmSince: 2044, everyKm: 1800, everyDays: 365, daysSince: 150, startDate: '2026-05-01', lastServiceAt: null, lastDoneAt: '2026-05-01', nextDueDate: '2027-05-01' }),
    rule({ id: 2, title: 'Clean and lube the chain', status: 'DUE', pct: 0.86, kmSince: 197, everyKm: 230, lastServiceAt: '2026-09-23', lastDoneAt: '2026-09-23', startDate: '2026-01-01' }),
    rule({ id: 3, title: 'Wax the chain', componentType: 'CHAIN', componentId: 10, status: 'PAUSED', pct: 0.1 }),
  ];
  const setup = (routes = {}, props = {}) => {
    const onChanged = vi.fn();
    const m = mockApi({ 'GET /maintenance/rules': rules, ...routes });
    renderWithProviders(<MaintenanceSection bikeId={1} parts={[component({ id: 10 })]} onChanged={onChanged} {...props} />);
    return { m, onChanged };
  };

  test('lists the rules with status, progress, last service or start date, and the next date', async () => {
    const { m } = setup();
    expect(await screen.findByText('Brake and gear adjustment')).toBeInTheDocument();
    expect(m.called('GET', '/maintenance/rules')[0].query).toEqual({ bikeId: '1' });
    const adjust = screen.getByText('Brake and gear adjustment').closest('div').parentElement.parentElement;
    expect(within(adjust).getByText('Overdue')).toBeInTheDocument();
    expect(within(adjust).getByText('2044 / 1800 km · 150 / 365 days')).toBeInTheDocument();
    expect(within(adjust).getByText(/counting from 01 May 2026/)).toBeInTheDocument(); // never done yet
    expect(within(adjust).getByText(/next by 01 May 2027/)).toBeInTheDocument();
    const clean = screen.getByText('Clean and lube the chain').closest('div').parentElement.parentElement;
    expect(within(clean).getByText(/last done 23 Sep/)).toBeInTheDocument();
    expect(within(clean).getByText('Due soon')).toBeInTheDocument();
    expect(screen.getByText('Chain', { selector: '.MuiChip-label' })).toBeInTheDocument(); // rule tied to a part
  });
  test('a rule about a retired part is paused and cannot be marked as done', async () => {
    setup();
    await screen.findByText('Wax the chain');
    const row = screen.getByText('Wax the chain').closest('div').parentElement.parentElement;
    expect(within(row).getByText('Paused')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Done' })).toBeDisabled();
  });
  test('without rules it explains and offers the suggested ones', async () => {
    setup({ 'GET /maintenance/rules': [] });
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument();
  });
  test('"Add suggested rules" posts for this bike, reloads and tells the parent', async () => {
    let list = [];
    const { m, onChanged } = setup({ 'GET /maintenance/rules': () => list, 'POST /maintenance/suggested': () => { list = rules; return list; } });
    await screen.findByText(/No rules yet/);
    await userEvent.click(screen.getByRole('button', { name: 'Add suggested rules' }));
    expect(await screen.findByText('Suggested rules added')).toBeInTheDocument();
    expect(m.called('POST', '/maintenance/suggested')[0].body).toEqual({ bikeId: 1 });
    expect(await screen.findByText('Brake and gear adjustment')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
  test('"Done" logs the job, confirms, and refreshes both the list and the page', async () => {
    const { m, onChanged } = setup({ 'POST /maintenance/rules/2/complete': { service: { id: 1 }, rule: rules[1] } });
    await screen.findByText('Clean and lube the chain');
    const row = screen.getByText('Clean and lube the chain').closest('div').parentElement.parentElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('"Clean and lube the chain" marked as done')).toBeInTheDocument();
    expect(m.called('POST', '/maintenance/rules/2/complete')).toHaveLength(1);
    await waitFor(() => expect(m.called('GET', '/maintenance/rules')).toHaveLength(2));
    expect(onChanged).toHaveBeenCalled();
  });
  test('a failure on "Done" is shown and nothing else happens', async () => {
    const { onChanged } = setup({ 'POST /maintenance/rules/2/complete': fail(500, { error: 'Internal server error' }) });
    await screen.findByText('Clean and lube the chain');
    await userEvent.click(within(screen.getByText('Clean and lube the chain').closest('div').parentElement.parentElement).getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled(); // nothing changed, so nothing is reloaded
    expect(screen.queryByText(/marked as done/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Done' })[0]).toBeEnabled(); // and the buttons come back
  });
  test('adding a rule opens the form for this bike and refreshes after saving', async () => {
    const { m, onChanged } = setup({ 'POST /maintenance/rules': (c) => ({ id: 9, ...c.body }) });
    await screen.findByText('Brake and gear adjustment');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.type(await screen.findByLabelText(/^What needs doing/), 'New one');
    await userEvent.type(screen.getByLabelText(/^Every/), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('POST', '/maintenance/rules')).toHaveLength(1));
    expect(m.called('POST', '/maintenance/rules')[0].body.bikeId).toBe(1);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  test('editing a rule opens it prefilled', async () => {
    const { m } = setup({ 'PUT /maintenance/rules/2': (c) => ({ id: 2, ...c.body }) });
    await screen.findByText('Clean and lube the chain');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Clean and lube the chain' }));
    expect(await screen.findByLabelText(/^What needs doing/)).toHaveValue('Clean and lube the chain');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.called('PUT', '/maintenance/rules/2')).toHaveLength(1));
  });
  test('deleting asks first and keeps logged services', async () => {
    const { m } = setup({ 'DELETE /maintenance/rules/1': null });
    await screen.findByText('Brake and gear adjustment');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Brake and gear adjustment' }));
    expect(screen.getByText(/Services you already logged are kept/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(m.called('DELETE', '/maintenance/rules/1')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Brake and gear adjustment' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(m.called('DELETE', '/maintenance/rules/1')).toHaveLength(1));
    expect(await screen.findByText('Rule deleted')).toBeInTheDocument();
  });
  test('a failed delete shows the error', async () => {
    setup({ 'DELETE /maintenance/rules/1': fail(500, { error: 'Internal server error' }) });
    await screen.findByText('Brake and gear adjustment');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Brake and gear adjustment' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
  });
  test('shows a placeholder while loading and the server error', async () => {
    mockApi({ 'GET /maintenance/rules': () => new Promise(() => {}) });
    const { unmount } = renderWithProviders(<MaintenanceSection bikeId={1} parts={[]} />);
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /maintenance/rules': fail(500, { error: 'Internal server error' }) });
    renderWithProviders(<MaintenanceSection bikeId={1} parts={[]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
});
