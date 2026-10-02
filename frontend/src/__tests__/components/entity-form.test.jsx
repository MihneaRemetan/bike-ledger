import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EntityFormDialog from '../../components/EntityFormDialog';
import { ApiError } from '../../api/client';
import { renderWithProviders } from '../../test/utils';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text', required: true, helperText: 'Pick a name' },
  { name: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'A', label: 'Alpha' }, { value: 'B', label: 'Beta' }] },
  { name: 'year', label: 'Year', type: 'number' },
  { name: 'when', label: 'When', type: 'date' },
  { name: 'at', label: 'At', type: 'datetime' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
  { name: 'flag', label: 'Flag', type: 'checkbox' },
];

const setup = (props = {}) => {
  const onSubmit = props.onSubmit || vi.fn().mockResolvedValue();
  const onClose = vi.fn();
  renderWithProviders(<EntityFormDialog open title="Edit thing" fields={FIELDS} onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose };
};

describe('EntityFormDialog', () => {
  test('renders the title, a control per field and helper text', () => {
    setup();
    expect(screen.getByText('Edit thing')).toBeInTheDocument();
    for (const l of ['Name', 'Type', 'Year', 'When', 'At', 'Notes']) expect(screen.getByLabelText(new RegExp(`^${l}`))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Flag' })).toBeInTheDocument();
    expect(screen.getByText('Pick a name')).toBeInTheDocument();
  });
  test('uses the right input kinds', () => {
    setup();
    expect(screen.getByLabelText(/^Year/)).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText(/^When/)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/^At/)).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText(/^Notes/).tagName).toBe('TEXTAREA');
  });
  test('initial values fill the form; datetime values are shown in local time', () => {
    setup({ initialValues: { name: 'Roadie', type: 'B', year: 2020, notes: 'hi', flag: true, at: '2025-05-01T08:30:00Z' } });
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Roadie');
    expect(screen.getByLabelText(/^Year/)).toHaveValue(2020);
    expect(screen.getByLabelText(/^Notes/)).toHaveValue('hi');
    expect(screen.getByRole('checkbox', { name: 'Flag' })).toBeChecked();
    expect(screen.getByLabelText(/^At/).value).toMatch(/^2025-05-0[12]T\d{2}:30$/);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
  test('submit passes the typed values; datetimes become ISO strings; empty fields are empty strings', async () => {
    const { onSubmit } = setup({ initialValues: { type: 'A' } });
    await userEvent.type(screen.getByLabelText(/^Name/), 'My bike');
    await userEvent.type(screen.getByLabelText(/^Year/), '2022');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Flag' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const v = onSubmit.mock.calls[0][0];
    expect(v).toMatchObject({ name: 'My bike', type: 'A', year: '2022', flag: true, notes: '', when: '', at: '' });
  });
  test('a datetime value is converted from local input back to an ISO string', async () => {
    const { onSubmit } = setup({ initialValues: { name: 'x', type: 'A', at: '2025-05-01T08:30:00Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].at).toBe('2025-05-01T08:30:00.000Z');
  });
  test('select options can be a function of the current values', async () => {
    const fields = [
      { name: 'bike', label: 'Bike', type: 'select', required: true, options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] },
      { name: 'part', label: 'Part', type: 'select', options: (v) => (v.bike === '1' ? [{ value: 'a', label: 'Part of one' }] : [{ value: 'b', label: 'Part of two' }]) },
    ];
    setup({ fields, initialValues: { bike: '1' } });
    await userEvent.click(screen.getByLabelText(/^Part/));
    expect(screen.getByRole('option', { name: 'Part of one' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Part of two' })).not.toBeInTheDocument();
  });
  test('optional selects offer a "None" choice, required ones do not', async () => {
    setup({ fields: [{ name: 'a', label: 'Opt', type: 'select', options: [{ value: '1', label: 'One' }] }, { name: 'b', label: 'Req', type: 'select', required: true, options: [{ value: '1', label: 'One' }] }] });
    await userEvent.click(screen.getByLabelText(/^Opt/));
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByLabelText(/^Req/));
    expect(screen.queryByRole('option', { name: 'None' })).not.toBeInTheDocument();
  });
  test('fields can be hidden by a predicate on the other values', async () => {
    const fields = [
      { name: 'flag', label: 'Show extra', type: 'checkbox' },
      { name: 'extra', label: 'Extra field', type: 'text', visible: (v) => v.flag },
    ];
    setup({ fields });
    expect(screen.queryByLabelText('Extra field')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show extra' }));
    expect(screen.getByLabelText('Extra field')).toBeInTheDocument();
  });
  test('onFieldChange can patch other fields', async () => {
    const fields = [{ name: 'type', label: 'Kind', type: 'select', options: [{ value: 'CHAIN', label: 'Chain' }] }, { name: 'max', label: 'Limit', type: 'number' }];
    setup({ fields, onFieldChange: (name, value) => (name === 'type' && value === 'CHAIN' ? { max: 4000 } : {}) });
    await userEvent.click(screen.getByLabelText(/^Kind/));
    await userEvent.click(screen.getByRole('option', { name: 'Chain' }));
    expect(screen.getByLabelText(/^Limit/)).toHaveValue(4000);
  });
  test('while saving the button is disabled and says so; it comes back afterwards', async () => {
    let finish;
    const onSubmit = vi.fn(() => new Promise((r) => { finish = r; }));
    setup({ onSubmit, initialValues: { name: 'x', type: 'A' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  });
  test('a custom submit label', () => {
    setup({ submitLabel: 'Create' });
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
  test('field errors from the server appear under the matching field and clear when the user edits it', async () => {
    const err = new ApiError(400, 'Validation failed', [{ field: 'name', message: 'Name is required' }, { field: 'year', message: 'Too low' }]);
    setup({ onSubmit: vi.fn().mockRejectedValue(err) });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Too low')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeInvalid();
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Name/), 'a');
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
    expect(screen.getByText('Too low')).toBeInTheDocument();
  });
  test('an error that matches no field is shown at the top of the form', async () => {
    setup({ onSubmit: vi.fn().mockRejectedValue(new ApiError(500, 'Server exploded')) });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded');
  });
  test('a plain Error without status is shown too', async () => {
    setup({ onSubmit: vi.fn().mockRejectedValue(new Error('Boom')) });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
  test('Cancel closes without submitting', async () => {
    const { onSubmit, onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  test('reopening the dialog resets the form and the errors', async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <EntityFormDialog open={open} title="T" fields={FIELDS} onClose={() => {}} onSubmit={() => Promise.reject(new ApiError(400, 'x', [{ field: 'name', message: 'bad name' }]))} />
        </>
      );
    }
    renderWithProviders(<Host />);
    await userEvent.type(screen.getByLabelText(/^Name/), 'typed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('bad name')).toBeInTheDocument();
    await userEvent.click(screen.getByText('toggle'));
    await waitFor(() => expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument());
    await userEvent.click(screen.getByText('toggle'));
    expect(await screen.findByLabelText(/^Name/)).toHaveValue('');
    expect(screen.queryByText('bad name')).not.toBeInTheDocument();
  });
  test('endAdornment text is rendered inside the field', () => {
    setup({ fields: [{ name: 'd', label: 'Distance', type: 'number', endAdornment: 'km' }] });
    expect(screen.getByText('km')).toBeInTheDocument();
  });
  test('nothing is rendered when closed', () => {
    setup({ open: false });
    expect(screen.queryByText('Edit thing')).not.toBeInTheDocument();
  });
});
