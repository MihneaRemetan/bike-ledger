import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Layout from '../../components/Layout';
import { session } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { renderWithProviders, mockApi, USER } from '../../test/utils';

// The real app unmounts the layout on logout (see Protected in App.jsx), so mimic that here
function Guarded() {
  const { user } = useAuth();
  return user ? <Layout><p>page content</p></Layout> : <p>logged out</p>;
}

const renderLayout = (route = '/dashboard') => {
  mockApi({ 'GET /auth/me': USER });
  return renderWithProviders(<Layout><p>page content</p></Layout>, { route });
};

describe('Layout', () => {
  test('shows the brand, the page content and every navigation link', () => {
    renderLayout();
    expect(screen.getByText('BikeLedger')).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
    const nav = { Dashboard: '/dashboard', Bikes: '/bikes', Components: '/components', Rides: '/rides', Map: '/map', Services: '/services', Statistics: '/statistics', Data: '/data' };
    for (const [name, href] of Object.entries(nav)) expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });
  test('the link of the current page is highlighted, others are not', () => {
    renderLayout('/rides');
    expect(screen.getByRole('link', { name: 'Rides' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'Bikes' })).not.toHaveClass('Mui-selected');
  });
  test('nested pages keep their section highlighted', () => {
    renderLayout('/bikes/12');
    expect(screen.getByRole('link', { name: 'Bikes' })).toHaveClass('Mui-selected');
  });
  test('clicking a link navigates', async () => {
    renderLayout('/dashboard');
    await userEvent.click(screen.getByRole('link', { name: 'Services' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/services');
  });
  test('the user menu shows the name and logging out clears the session', async () => {
    mockApi({ 'GET /auth/me': USER });
    renderWithProviders(<Guarded />, { route: '/dashboard' });
    expect(session.token).toBe('test-token');
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }));
    expect(screen.getByText(USER.name)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
    expect(session.token).toBeNull();
    expect(screen.getByText('logged out')).toBeInTheDocument();
  });
  test('the avatar shows the first letter of the name', () => {
    renderLayout();
    expect(within(screen.getByRole('button', { name: 'User menu' })).getByText('M')).toBeInTheDocument();
  });
  test('has a dark mode toggle', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(localStorage.getItem('bikeledger.mode')).toBe('dark');
  });
  test('on a narrow screen the menu is behind a hamburger button', async () => {
    globalThis.__media.desktop = false;
    renderLayout();
    const burger = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(burger);
    expect(await screen.findByRole('link', { name: 'Bikes' })).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Bikes' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/bikes');
  });
  test('on a wide screen there is no hamburger button', () => {
    renderLayout();
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
  });
});
