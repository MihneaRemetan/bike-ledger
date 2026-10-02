import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GpxImportDialog from '../../components/GpxImportDialog';
import { renderWithProviders, mockApi, fail, bike } from '../../test/utils';

const bikes = [bike({ id: 1, name: 'Gravel' }), bike({ id: 2, name: 'Commuter' })];
const PREVIEW = { bikeId: 1, title: 'Afternoon Ride', date: '2026-09-13T11:42:41.000Z', distanceKm: 48.4, durationMin: 136, elevationM: 13, routePoints: 93 };
const gpxFile = (name = 'ride.gpx') => new File(['<gpx/>'], name, { type: 'application/gpx+xml' });
const fileInput = () => document.querySelector('input[type="file"]');
const uploadFile = (name) => userEvent.upload(fileInput(), gpxFile(name));
const chooseBike = async (name) => {
  await userEvent.click(screen.getByLabelText(/^Bike/));
  await userEvent.click(await screen.findByRole('option', { name }));
};
const open = (props = {}) => renderWithProviders(<GpxImportDialog open bikes={bikes} onClose={() => {}} onSaved={() => {}} {...props} />);

describe('GpxImportDialog', () => {
  test('explains where to get a file, including Strava, and accepts GPX/TCX files', () => {
    open();
    expect(screen.getByText('Import a ride from a file')).toBeInTheDocument();
    expect(screen.getByText(/Export GPX/)).toBeInTheDocument();
    expect(screen.getByText(/Strava/)).toBeInTheDocument();
    expect(fileInput().getAttribute('accept')).toMatch(/\.gpx.*\.tcx/);
    expect(screen.getByRole('button', { name: 'Save ride' })).toBeDisabled();
  });
  test('choosing a file previews it without saving, and shows every computed value', async () => {
    const m = mockApi({ 'POST /rides/import-gpx': PREVIEW });
    open({ defaultBikeId: 1 });
    await uploadFile('Afternoon_Ride.gpx');
    expect(await screen.findByText('Afternoon Ride')).toBeInTheDocument();
    expect(screen.getByText('48.4 km')).toBeInTheDocument();
    expect(screen.getByText('2:16')).toBeInTheDocument();
    expect(screen.getByText('13 m')).toBeInTheDocument();
    expect(screen.getByText(/^13 Sep/)).toBeInTheDocument(); // "Sep" or "Sept" depending on the ICU version
    const form = m.called('POST', '/rides/import-gpx')[0].body;
    expect([form.get('bikeId'), form.get('preview')]).toEqual(['1', 'true']);
    expect(form.get('file').name).toBe('Afternoon_Ride.gpx');
    expect(screen.getByRole('button', { name: 'Save ride' })).toBeEnabled();
  });
  test('without a bike the preview waits; picking the bike then triggers it', async () => {
    const m = mockApi({ 'POST /rides/import-gpx': PREVIEW });
    open();
    await uploadFile();
    expect(screen.getByText('Pick a bike to see the preview.')).toBeInTheDocument();
    expect(m.called('POST', '/rides/import-gpx')).toHaveLength(0);
    await chooseBike('Commuter');
    expect(await screen.findByText('Afternoon Ride')).toBeInTheDocument();
    expect(m.called('POST', '/rides/import-gpx')[0].body.get('bikeId')).toBe('2');
  });
  test('Save ride imports for real (no preview flag), confirms and reports the ride', async () => {
    const saved = { id: 99, title: 'Afternoon Ride' };
    const m = mockApi({ 'POST /rides/import-gpx': (c) => (c.body.get('preview') ? PREVIEW : saved) });
    const onSaved = vi.fn();
    open({ defaultBikeId: 1, onSaved });
    await uploadFile();
    await screen.findByText('Afternoon Ride');
    await userEvent.click(screen.getByRole('button', { name: 'Save ride' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const calls = m.called('POST', '/rides/import-gpx');
    expect(calls).toHaveLength(2);
    expect(calls[1].body.has('preview')).toBe(false);
    expect(await screen.findByText('Ride imported from GPX')).toBeInTheDocument();
  });
  test('an unreadable file shows the server message and cannot be saved', async () => {
    mockApi({ 'POST /rides/import-gpx': fail(400, { error: 'Not a GPX or TCX file' }) });
    open({ defaultBikeId: 1 });
    await uploadFile('notes.txt');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a GPX or TCX file');
    expect(screen.getByRole('button', { name: 'Save ride' })).toBeDisabled();
  });
  test('a failure while saving is shown and the dialog stays open', async () => {
    mockApi({ 'POST /rides/import-gpx': (c) => (c.body.get('preview') ? PREVIEW : fail(500, { error: 'Internal server error' })) });
    const onSaved = vi.fn();
    open({ defaultBikeId: 1, onSaved });
    await uploadFile();
    await screen.findByText('Afternoon Ride');
    await userEvent.click(screen.getByRole('button', { name: 'Save ride' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(onSaved).not.toHaveBeenCalled();
  });
  test('the chosen file name replaces the "Choose a file" label', async () => {
    mockApi({ 'POST /rides/import-gpx': PREVIEW });
    open({ defaultBikeId: 1 });
    expect(screen.getByRole('button', { name: 'Choose a GPX or TCX file' })).toBeInTheDocument();
    await uploadFile('my-ride.gpx');
    expect(screen.getByRole('button', { name: 'my-ride.gpx' })).toBeInTheDocument();
  });
  test('Cancel closes the dialog', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
