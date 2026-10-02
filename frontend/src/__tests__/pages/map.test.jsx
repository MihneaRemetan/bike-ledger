import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapPage from '../../pages/MapPage';
import { renderWithProviders, mockApi, fail, bike } from '../../test/utils';

// A fake Leaflet map: the real one needs a browser layout engine. Components render simple markers we can inspect.
const fakeMap = vi.hoisted(() => ({
  getCenter: () => ({ lat: 45.75, lng: 21.22 }),
  getBounds: () => ({ getNorthEast: () => ({}) }),
  distance: () => 12400,
  setView: vi.fn(), flyTo: vi.fn(), fitBounds: vi.fn(), invalidateSize: vi.fn(), getSize: () => ({ x: 800, y: 600 }),
}));
vi.mock('react-leaflet', async () => {
  const React = await import('react');
  return {
    MapContainer: React.forwardRef(({ children }, ref) => {
      React.useImperativeHandle(ref, () => fakeMap);
      return <div data-testid="map">{children}</div>;
    }),
    TileLayer: () => null,
    useMap: () => fakeMap,
    Polyline: ({ positions, pathOptions, children }) => <div data-testid="route" data-color={pathOptions.color} data-points={positions.length}>{children}</div>,
    Popup: ({ children }) => <div data-testid="popup">{children}</div>,
    Tooltip: ({ children }) => <span>{children}</span>,
    Circle: ({ radius }) => <div data-testid="accuracy" data-radius={radius} />,
    Marker: ({ position, draggable, eventHandlers, children }) =>
      draggable ? (
        <button data-testid="search-dot" data-position={position.join(',')} onClick={() => eventHandlers.dragend({ target: { getLatLng: () => ({ lat: 45.7, lng: 21.1 }) } })}>{children}</button>
      ) : (
        <div data-testid="shop-pin" data-position={position.join(',')}>{children}</div>
      ),
  };
});

const route = (id, bikeId, title, extra = {}) => ({ id, bikeId, bikeName: bikeId === 1 ? 'Gravel' : 'Commuter', date: '2025-05-01T08:00:00Z', title, distanceKm: 40, points: [[45.7, 21.2], [45.8, 21.3], [45.75, 21.25]], ...extra });
const ROUTES = [route(1, 1, 'West loop'), route(2, 1, 'South loop', { distanceKm: 28.4 }), route(3, 2, 'Home to work', { distanceKm: 5.1 })];
const SHOPS = [
  { id: 'node/1', name: 'Near Shop', lat: 45.751, lon: 21.221, address: 'Strada Mare 5, Timisoara', phone: '+40 256 123 456', website: 'https://near.example', openingHours: 'Mo-Fr 09:00-18:00', brand: 'Canyon', repair: true, distanceKm: 0.2 },
  { id: 'node/2', name: 'Far Shop', lat: 45.76, lon: 21.24, address: null, phone: null, website: 'far.example', openingHours: null, brand: null, repair: false, distanceKm: 3.4 },
];
const bikes = [bike({ id: 1, name: 'Gravel' }), bike({ id: 2, name: 'Commuter' })];

const setup = (routes = {}, route = '/map') => {
  const m = mockApi({ 'GET /bikes': bikes, 'GET /rides/routes': ROUTES, 'GET /places/bike-shops': SHOPS, ...routes });
  renderWithProviders(<MapPage />, { route });
  return m;
};
const findShops = async () => userEvent.click(await screen.findByRole('button', { name: 'Find bike shops in this area' }));

beforeEach(() => {
  Object.values(fakeMap).filter((f) => f.mockClear).forEach((f) => f.mockClear());
});

describe('Map page: routes', () => {
  test('draws every route, coloured per bike, with a legend and a total', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByTestId('route')).toHaveLength(3));
    const [a, b, c] = screen.getAllByTestId('route');
    expect(a.dataset.color).toBe(b.dataset.color); // same bike, same colour
    expect(a.dataset.color).not.toBe(c.dataset.color);
    expect(screen.getByText('3 routes · 73.5 km')).toBeInTheDocument();
    expect(screen.getByText('Gravel', { selector: '.MuiChip-label' })).toBeInTheDocument();
    expect(screen.getByText('Commuter', { selector: '.MuiChip-label' })).toBeInTheDocument();
  });
  test('a route popup shows title, date, distance and a link to the bike', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByTestId('popup')).toHaveLength(3));
    const popup = within(screen.getAllByTestId('popup')[1]);
    expect(popup.getByText('South loop')).toBeInTheDocument();
    expect(popup.getByText(/01 May 2025 · 28\.4 km/)).toBeInTheDocument();
    expect(popup.getByRole('link', { name: 'Gravel' })).toHaveAttribute('href', '/bikes/1');
  });
  test('"Show routes" hides the routes and the colour legend, and brings them back', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByTestId('route')).toHaveLength(3));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show routes' }));
    expect(screen.queryAllByTestId('route')).toHaveLength(0);
    expect(screen.queryByText('Gravel', { selector: '.MuiChip-label' })).not.toBeInTheDocument();
    expect(screen.queryByText('Commuter', { selector: '.MuiChip-label' })).not.toBeInTheDocument();
    expect(screen.getByText(/Routes are hidden/)).toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show routes' }));
    expect(screen.getAllByTestId('route')).toHaveLength(3);
    expect(screen.getByText('Gravel', { selector: '.MuiChip-label' })).toBeInTheDocument();
  });
  test('filters by bike and dates through the request', async () => {
    const m = setup();
    await waitFor(() => expect(screen.getAllByTestId('route')).toHaveLength(3));
    expect(m.called('GET', '/rides/routes')[0].query).toEqual({ limit: '500' });
    await userEvent.click(screen.getByLabelText(/^Bike/));
    await userEvent.click(await screen.findByRole('option', { name: 'Commuter' }));
    await userEvent.type(screen.getByLabelText('From'), '2025-01-01');
    await waitFor(() => expect(m.called('GET', '/rides/routes').at(-1).query).toEqual({ bikeId: '2', from: '2025-01-01', limit: '500' }));
  });
  test('fits the map to the routes, or to a single ride when opened from the Rides page', async () => {
    setup();
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    expect(fakeMap.fitBounds.mock.calls[0][0]).toHaveLength(9); // all points of all routes
    fakeMap.fitBounds.mockClear();
    setup({}, '/map?ride=2');
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalled());
    expect(fakeMap.fitBounds.mock.calls.at(-1)[0]).toHaveLength(3); // just that ride
  });
  test('waits until the map container has a size before fitting (otherwise Leaflet would zoom to the maximum)', async () => {
    const sizes = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 800, y: 600 }];
    const original = fakeMap.getSize;
    fakeMap.getSize = vi.fn(() => sizes.shift() || { x: 800, y: 600 });
    try {
      setup();
      await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalledTimes(1), { timeout: 3000 });
      expect(fakeMap.getSize.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      fakeMap.getSize = original;
    }
  });
  test('without routes it says how to get some but still shows the map', async () => {
    setup({ 'GET /rides/routes': [] });
    expect(await screen.findByText(/No routes yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rides' })).toHaveAttribute('href', '/rides');
    expect(screen.getByText(/Export GPX/)).toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find bike shops in this area' })).toBeInTheDocument();
  });
  test('shows the server error', async () => {
    setup({ 'GET /rides/routes': fail(500, { error: 'Internal server error' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
  test('a skeleton is shown while the routes load', () => {
    mockApi({ 'GET /bikes': bikes, 'GET /rides/routes': () => new Promise(() => {}) });
    renderWithProviders(<MapPage />);
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
  });
});

describe('Map page: bike shops', () => {
  test('the location button is called "My Location"', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'My Location' })).toBeInTheDocument();
    expect(screen.queryByText('Near me')).not.toBeInTheDocument();
  });
  test('searching sends the map centre and a radius derived from the visible area', async () => {
    const m = setup();
    await findShops();
    await waitFor(() => expect(m.called('GET', '/places/bike-shops')).toHaveLength(1));
    expect(m.called('GET', '/places/bike-shops')[0].query).toEqual({ lat: '45.75', lon: '21.22', radiusKm: '12' });
  });
  test('shows a waiting message while searching', async () => {
    let finish;
    setup({ 'GET /places/bike-shops': () => new Promise((r) => { finish = () => r(SHOPS); }) });
    await findShops();
    expect(await screen.findByText(/may take up to half a minute/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find bike shops in this area' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByText(/may take up to half a minute/)).not.toBeInTheDocument());
  });
  test('results appear as pins, with a draggable search point, and the map zooms to them', async () => {
    setup();
    await findShops();
    await waitFor(() => expect(screen.getAllByTestId('shop-pin')).toHaveLength(2));
    expect(screen.getByTestId('search-dot').dataset.position).toBe('45.75,21.22');
    await waitFor(() => expect(fakeMap.fitBounds.mock.calls.some((c) => c[0].length === 3)).toBe(true));
  });
  test('the list shows each shop nearest first with address, hours, brand, repairs badge and links', async () => {
    setup();
    await findShops();
    const card = (await screen.findByText('Bike shops nearby')).closest('.MuiCard-root');
    const near = within(card.querySelector('.MuiLink-root[type="button"]').closest('div').parentElement.parentElement);
    expect(near.getByText('Near Shop')).toBeInTheDocument();
    expect(near.getByText('Repairs')).toBeInTheDocument();
    expect(near.getByText('Canyon')).toBeInTheDocument();
    expect(near.getByText('Strada Mare 5, Timisoara')).toBeInTheDocument();
    expect(near.getByText('Hours: Mo-Fr 09:00-18:00')).toBeInTheDocument();
    expect(near.getByText('0.2 km')).toBeInTheDocument();
    expect(near.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/directions'));
    expect(near.getByRole('link', { name: 'Directions' }).getAttribute('href')).toContain('45.751%2C21.221');
    expect(near.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://near.example');
    expect(near.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+40256123456');
    expect(within(card).getByText('Address not listed')).toBeInTheDocument(); // the far shop has none
    expect(within(card).getByText('3.4 km')).toBeInTheDocument();
    expect(within(card).getByText(/not part of this data/)).toBeInTheDocument();
  });
  test('website links without a scheme get https, and are always opened safely', async () => {
    setup();
    await findShops();
    await screen.findByText('Bike shops nearby');
    const far = screen.getAllByRole('link', { name: 'Website' }).find((a) => a.getAttribute('href').includes('far.example'));
    expect(far).toHaveAttribute('href', 'https://far.example');
    expect(far).toHaveAttribute('rel', 'noopener noreferrer');
    expect(far).toHaveAttribute('target', '_blank');
  });
  test('clicking a shop name centres the map on it', async () => {
    setup();
    await findShops();
    await userEvent.click(await screen.findByRole('button', { name: 'Far Shop' }));
    expect(fakeMap.flyTo).toHaveBeenCalledWith([45.76, 21.24], 16);
  });
  test('pin popups repeat the key details', async () => {
    setup();
    await findShops();
    await waitFor(() => expect(screen.getAllByTestId('shop-pin')).toHaveLength(2));
    const popup = within(screen.getAllByTestId('shop-pin')[0]);
    expect(popup.getByText('Near Shop')).toBeInTheDocument();
    expect(popup.getByText('Repairs')).toBeInTheDocument();
    expect(popup.getByText('0.2 km away')).toBeInTheDocument();
  });
  test('no shops found gives a helpful message', async () => {
    setup({ 'GET /places/bike-shops': [] });
    await findShops();
    expect(await screen.findByText(/No bike shops found within 12 km/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('shop-pin')).toHaveLength(0);
  });
  test('an error offers "Try again", which repeats the same search', async () => {
    let attempt = 0;
    const m = setup({ 'GET /places/bike-shops': () => (++attempt === 1 ? fail(502, { error: 'The map data service is busy right now. Please try again in a moment.' }) : SHOPS) });
    await findShops();
    expect(await screen.findByText(/map data service is busy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByTestId('shop-pin')).toHaveLength(2));
    expect(screen.queryByText(/map data service is busy/)).not.toBeInTheDocument();
    const calls = m.called('GET', '/places/bike-shops');
    expect(calls[1].query).toEqual(calls[0].query);
  });
  test('"Hide shops" removes pins and the list; routes stay', async () => {
    setup();
    await findShops();
    await screen.findByText('Bike shops nearby');
    await userEvent.click(screen.getByRole('button', { name: 'Hide shops' }));
    expect(screen.queryByText('Bike shops nearby')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('shop-pin')).toHaveLength(0);
    expect(screen.getAllByTestId('route')).toHaveLength(3);
  });
  test('dragging the search point repeats the search from the new position', async () => {
    const m = setup();
    await findShops();
    await userEvent.click(await screen.findByTestId('search-dot'));
    await waitFor(() => expect(m.called('GET', '/places/bike-shops')).toHaveLength(2));
    expect(m.called('GET', '/places/bike-shops')[1].query).toMatchObject({ lat: '45.7', lon: '21.1', radiusKm: '12' });
  });

  describe('My Location', () => {
    const geo = (impl) => { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn(impl) }, configurable: true }); return navigator.geolocation; };
    afterEach(() => { delete navigator.geolocation; });

    test('uses the browser position with high accuracy, moves the map there and searches within 8 km', async () => {
      const g = geo((ok) => ok({ coords: { latitude: 45.73, longitude: 21.2, accuracy: 40 } }));
      const m = setup();
      await userEvent.click(await screen.findByRole('button', { name: 'My Location' }));
      await waitFor(() => expect(m.called('GET', '/places/bike-shops')).toHaveLength(1));
      expect(m.called('GET', '/places/bike-shops')[0].query).toEqual({ lat: '45.73', lon: '21.2', radiusKm: '8' });
      expect(fakeMap.setView).toHaveBeenCalledWith([45.73, 21.2], 13);
      expect(g.getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true });
      expect((await screen.findByTestId('accuracy')).dataset.radius).toBe('40');
      expect(screen.queryByText(/accuracy of about/)).not.toBeInTheDocument(); // precise enough: no warning
    });
    test('a rough location shows the accuracy and tells the user to drag the dot', async () => {
      geo((ok) => ok({ coords: { latitude: 45.73, longitude: 21.2, accuracy: 3200 } }));
      setup();
      await userEvent.click(await screen.findByRole('button', { name: 'My Location' }));
      expect(await screen.findByText(/accuracy of about 3\.2 km/)).toBeInTheDocument();
      expect(screen.getByText(/drag it to your real position/)).toBeInTheDocument();
    });
    test('a refused permission explains what to do and does not search', async () => {
      geo((ok, err) => err({ code: 1 }));
      const m = setup();
      await userEvent.click(await screen.findByRole('button', { name: 'My Location' }));
      expect(await screen.findByText(/Could not get your location/)).toBeInTheDocument();
      expect(m.called('GET', '/places/bike-shops')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'My Location' })).toBeEnabled();
    });
    test('browsers without geolocation get a clear message', async () => {
      delete navigator.geolocation;
      setup();
      await userEvent.click(await screen.findByRole('button', { name: 'My Location' }));
      expect(await screen.findByText('Your browser does not support location.')).toBeInTheDocument();
    });
  });
});
