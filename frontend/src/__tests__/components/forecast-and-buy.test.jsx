import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WearBar from '../../components/WearBar';
import BuyMenu from '../../components/BuyMenu';
import MaintenanceSection from '../../components/MaintenanceSection';
import { fmtIn } from '../../lib/format';
import { buyLinks, partSearchTerms } from '../../lib/shopping';
import { renderWithProviders, mockApi, component, rule } from '../../test/utils';

describe('fmtIn', () => {
  test.each([
    [0, 'now'], [-3, 'now'], [1, 'tomorrow'], [2, 'in 2 days'], [13, 'in 13 days'], [14, 'in about 2 weeks'], [30, 'in about 4 weeks'],
    [59, 'in about 8 weeks'], [60, 'in about 2 months'], [200, 'in about 7 months'], [364, 'in about 12 months'], [365, 'in about a year'],
    [729, 'in about a year'], [730, 'in about 2 years'], [2000, 'in about 5 years'],
  ])('%i days reads "%s"', (days, text) => {
    expect(fmtIn(days)).toBe(text);
  });
});

describe('WearBar forecast line', () => {
  const forecast = (o) => ({ kmPerDay: 5, windowDays: 90, remainingKm: 500, status: 'DATE', daysLeft: 100, date: '2026-12-14', ...o });
  const bar = (f) => renderWithProviders(<WearBar component={component({ forecast: f })} />);

  test('a date with a friendly distance in time', () => {
    bar(forecast());
    expect(screen.getByText(/Limit expected 14 Dec 2026 \(in about 3 months\)/)).toBeInTheDocument();
  });
  test('the pace it is based on is available as a tooltip', () => {
    bar(forecast({ kmPerDay: 3.5, windowDays: 31 }));
    expect(screen.getByText(/Limit expected/)).toHaveAttribute('title', 'Based on 3.5 km/day over the last 31 days');
  });
  test.each([
    ['NOW', 'Limit reached'], ['FAR', 'Limit is years away at your pace'], ['NO_RECENT_RIDES', 'No recent rides to estimate a date'],
  ])('%s says "%s"', (status, text) => {
    bar(forecast({ status, date: null, daysLeft: null }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });
  test('no line without a forecast (retired parts, older answers) or when asked to hide it', () => {
    const { unmount } = renderWithProviders(<WearBar component={component({ forecast: null })} />);
    expect(screen.queryByText(/limit|estimate/i)).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<WearBar hideForecast component={component({ forecast: forecast() })} />);
    expect(screen.queryByText(/Limit expected/)).not.toBeInTheDocument();
  });
});

describe('shopping helpers', () => {
  test('brand and model make the best search, followed by the kind of part', () => {
    expect(partSearchTerms(component({ type: 'BRAKE_PADS', brand: 'Shimano', model: 'L03A Resin' }), 'GRAVEL')).toBe('Shimano L03A Resin brake pads');
    expect(partSearchTerms(component({ type: 'CHAIN', brand: 'KMC', model: null }), 'ROAD')).toBe('KMC chain');
  });
  test('without a name it uses the part and the kind of bike, or just "bicycle"', () => {
    const bare = component({ type: 'TYRE_REAR', brand: null, model: null });
    expect(partSearchTerms(bare, 'GRAVEL')).toBe('rear tyre gravel bike');
    expect(partSearchTerms(bare, 'MTB')).toBe('rear tyre mountain bike');
    expect(partSearchTerms(bare)).toBe('rear tyre bicycle');
  });
  test('one search link per shop, with the terms safely encoded', () => {
    const { terms, links } = buyLinks(component({ type: 'CHAIN', brand: 'KMC', model: 'X11 & "more"' }), 'GRAVEL');
    expect(terms).toBe('KMC X11 & "more" chain');
    expect(links.map((l) => l.name)).toEqual(['Google Shopping', 'Amazon', 'eBay', 'eMAG']);
    const q = encodeURIComponent(terms);
    expect(links[0].url).toBe(`https://www.google.com/search?tbm=shop&q=${q}`);
    expect(links[1].url).toBe(`https://www.amazon.de/s?k=${q}`);
    expect(links[2].url).toBe(`https://www.ebay.com/sch/i.html?_nkw=${q}`);
    expect(links[3].url).toBe(`https://www.emag.ro/search/${q}`);
    expect(links.every((l) => !l.url.includes(' ') && !l.url.includes('"'))).toBe(true);
  });
});

describe('BuyMenu', () => {
  const open = async (props = {}) => {
    renderWithProviders(<BuyMenu component={component({ type: 'CHAIN', brand: 'KMC', model: 'X11' })} bikeType="GRAVEL" {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Buy a replacement' }));
  };
  test('opens a menu with what is searched for and one link per shop', async () => {
    await open();
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Search for “KMC X11 chain”')).toBeInTheDocument();
    const link = (name) => within(menu).getByRole('menuitem', { name });
    expect(link('Google Shopping')).toHaveAttribute('href', expect.stringContaining('google.com/search?tbm=shop&q=KMC%20X11%20chain'));
    expect(link('Amazon')).toHaveAttribute('href', expect.stringContaining('amazon.de/s?k=KMC%20X11%20chain'));
    expect(link('eBay')).toHaveAttribute('href', expect.stringContaining('ebay.com/sch/i.html?_nkw=KMC%20X11%20chain'));
    expect(link('eMAG')).toHaveAttribute('href', expect.stringContaining('emag.ro/search/KMC%20X11%20chain'));
  });
  test('shop links open in a new tab without leaking the page', async () => {
    await open();
    for (const name of ['Google Shopping', 'Amazon', 'eBay', 'eMAG']) {
      const a = await screen.findByRole('menuitem', { name });
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
  test('says plainly that nothing is earned and offers the map for local shops', async () => {
    await open();
    expect(await screen.findByText(/BikeLedger earns nothing/)).toBeInTheDocument();
    const nearby = screen.getByRole('menuitem', { name: /Bike shops near me/ });
    expect(nearby).toHaveAttribute('href', '/map');
    await userEvent.click(nearby);
    expect(screen.getByTestId('location')).toHaveTextContent('/map');
  });
  test('picking a shop closes the menu', async () => {
    await open();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'eMAG' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  test('the icon only looks urgent for worn parts', () => {
    const { unmount } = renderWithProviders(<BuyMenu component={component({ status: 'REPLACE' })} />);
    expect(screen.getByRole('button', { name: 'Buy a replacement' })).toHaveClass('MuiIconButton-colorWarning');
    unmount();
    renderWithProviders(<BuyMenu component={component({ status: 'OK' })} />);
    expect(screen.getByRole('button', { name: 'Buy a replacement' })).not.toHaveClass('MuiIconButton-colorWarning');
  });
  test('works without a bike type (as on the dashboard)', async () => {
    await open({ component: component({ type: 'TYRE_REAR', brand: null, model: null }), bikeType: undefined });
    expect(await screen.findByText('Search for “rear tyre bicycle”')).toBeInTheDocument();
  });
});

describe('MaintenanceSection expected date', () => {
  const setup = (rules) => {
    mockApi({ 'GET /maintenance/rules': rules });
    renderWithProviders(<MaintenanceSection bikeId={1} parts={[]} />);
  };
  test('shows the expected date from the forecast, with distance-based rules too', async () => {
    setup([rule({ id: 1, title: 'By km', everyKm: 300, nextDueDate: null, forecast: { date: '2026-11-20', basis: 'KM' } })]);
    expect(await screen.findByText(/expected 20 Nov 2026/)).toBeInTheDocument();
  });
  test('falls back to the next date for older answers, and shows nothing when there is none', async () => {
    setup([rule({ id: 1, title: 'Old', nextDueDate: '2027-05-01' }), rule({ id: 2, title: 'None', nextDueDate: null })]);
    expect(await screen.findByText(/next by 01 May 2027/)).toBeInTheDocument();
    expect(screen.queryAllByText(/expected/)).toHaveLength(0);
  });
});
