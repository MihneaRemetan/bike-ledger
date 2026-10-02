import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusChip from '../../components/StatusChip';
import WearBar from '../../components/WearBar';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';
import BikeFilter from '../../components/BikeFilter';
import GettingStarted from '../../components/GettingStarted';
import PhotoBanner from '../../components/PhotoBanner';
import { useNotify } from '../../components/Notify';
import { renderWithProviders, component } from '../../test/utils';

describe('StatusChip', () => {
  test.each([['OK', 'OK'], ['WARN', 'Wearing out'], ['REPLACE', 'Replace now'], ['RETIRED', 'Retired']])('%s shows "%s"', (status, text) => {
    renderWithProviders(<StatusChip status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
  test('an unknown status falls back to its raw value', () => {
    renderWithProviders(<StatusChip status="WEIRD" />);
    expect(screen.getByText('WEIRD')).toBeInTheDocument();
  });
});

describe('WearBar', () => {
  test('shows used / limit km, the percentage, the status chip and a progress bar', () => {
    renderWithProviders(<WearBar component={component({ wearKm: 2958, maxKm: 3500, wearPct: 0.845, status: 'WARN' })} />);
    expect(screen.getByText('2958 / 3500 km (85%)')).toBeInTheDocument();
    expect(screen.getByText('Wearing out')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85');
  });
  test('the bar never overflows past 100% but the text shows the real percentage', () => {
    renderWithProviders(<WearBar component={component({ wearKm: 4237, maxKm: 4000, wearPct: 1.059, status: 'REPLACE' })} />);
    expect(screen.getByText('4237 / 4000 km (106%)')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
  test('the chip can be hidden', () => {
    renderWithProviders(<WearBar hideChip component={component()} />);
    expect(screen.queryByText('OK')).not.toBeInTheDocument();
  });
});

describe('PageHeader and EmptyState', () => {
  test('PageHeader shows title, optional subtitle and actions', () => {
    renderWithProviders(<PageHeader title="Bikes" subtitle="Your bikes" actions={<button>Add</button>} />);
    expect(screen.getByRole('heading', { name: 'Bikes' })).toBeInTheDocument();
    expect(screen.getByText('Your bikes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
  test('PageHeader without a subtitle', () => {
    renderWithProviders(<PageHeader title="Only title" />);
    expect(screen.getByRole('heading', { name: 'Only title' })).toBeInTheDocument();
  });
  test('EmptyState with an action button', async () => {
    const onAction = vi.fn();
    renderWithProviders(<EmptyState title="Nothing here" text="Add something" actionLabel="Add it" onAction={onAction} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add something')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add it' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
  test('EmptyState without an action has no button', () => {
    renderWithProviders(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  test('shows title and text; Cancel closes without confirming', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(<ConfirmDialog open title="Delete bike?" text="This cannot be undone" onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText('Delete bike?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
  test('Delete confirms, and both buttons are disabled while it runs', async () => {
    let finish;
    const onConfirm = vi.fn(() => new Promise((r) => { finish = r; }));
    renderWithProviders(<ConfirmDialog open text="x" onClose={() => {}} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
  });
  test('a custom confirm label and nothing rendered when closed', () => {
    const { rerender } = renderWithProviders(<ConfirmDialog open={false} text="x" confirmLabel="Remove" onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByText('x')).not.toBeInTheDocument();
    expect(rerender).toBeDefined();
  });
});

describe('BikeFilter', () => {
  const bikes = [{ id: 1, name: 'Gravel' }, { id: 2, name: 'Commuter' }];
  test('lists all bikes plus "All bikes" and reports the selection as a string id', async () => {
    const onChange = vi.fn();
    renderWithProviders(<BikeFilter bikes={bikes} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All bikes', 'Gravel', 'Commuter']);
    await userEvent.click(screen.getByRole('option', { name: 'Commuter' }));
    expect(onChange).toHaveBeenCalledWith('2');
  });
  test('works while the bikes are still loading', async () => {
    renderWithProviders(<BikeFilter bikes={null} value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});

describe('GettingStarted', () => {
  const steps = (done) => [
    { title: 'Add your bike', text: 'Name and type', action: 'Add bike', done: done[0], onClick: vi.fn() },
    { title: 'Add the parts', text: 'Chain etc', action: 'Add parts', done: done[1], onClick: vi.fn() },
    { title: 'Log a ride', text: 'By hand', action: 'Log a ride', done: done[2], onClick: vi.fn() },
  ];
  test('shows every step, progress and an action for each unfinished step', async () => {
    const s = steps([false, false, false]);
    renderWithProviders(<GettingStarted steps={s} />);
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
    for (const t of ['Add your bike', 'Add the parts', 'Log a ride']) expect(screen.getByText(t, { selector: 'p' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add parts' }));
    expect(s[1].onClick).toHaveBeenCalledOnce();
  });
  test('finished steps lose their button and count as done', () => {
    renderWithProviders(<GettingStarted steps={steps([true, true, false])} />);
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add bike' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add parts' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log a ride' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
  });
});

describe('PhotoBanner', () => {
  test('renders the title and subtitle over the image', () => {
    renderWithProviders(<PhotoBanner image="/images/welcome.jpg" title="Welcome, Ana" subtitle="Let's start" />);
    expect(screen.getByRole('heading', { name: 'Welcome, Ana' })).toBeInTheDocument();
    expect(screen.getByText("Let's start")).toBeInTheDocument();
  });
});

describe('Notify', () => {
  function Buttons() {
    const n = useNotify();
    return (<><button onClick={() => n.success('Saved!')}>ok</button><button onClick={() => n.error('Broke!')}>bad</button></>);
  }
  test('shows success and error messages as alerts', async () => {
    renderWithProviders(<Buttons />);
    await userEvent.click(screen.getByText('ok'));
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByText('Saved!')).toBeInTheDocument();
    await userEvent.click(screen.getByText('bad'));
    expect(await screen.findByText('Broke!')).toBeInTheDocument();
  });
  test('the message can be dismissed', async () => {
    renderWithProviders(<Buttons />);
    await userEvent.click(screen.getByText('ok'));
    await userEvent.click(await screen.findByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByText('Saved!')).not.toBeInTheDocument());
  });
});
