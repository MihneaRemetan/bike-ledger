import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { ColorModeProvider, useColorMode } from '../ColorMode';
import ColorModeToggle from '../components/ColorModeToggle';
import { session } from '../api/client';
import { mockApi, fail, USER } from '../test/utils';

function AuthProbe() {
  const { user, ready, login, register, logout } = useAuth();
  return (
    <div>
      <div data-testid="ready">{String(ready)}</div>
      <div data-testid="user">{user ? user.name : 'none'}</div>
      <button onClick={() => login('a@b.co', 'secret').catch((e) => { document.title = e.message; })}>login</button>
      <button onClick={() => register('Ana', 'a@b.co', 'secret123')}>register</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}
const renderAuth = () => render(<AuthProvider><AuthProbe /></AuthProvider>);

describe('AuthProvider', () => {
  test('without a stored token it is ready immediately and logged out', () => {
    mockApi();
    renderAuth();
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
  test('with a stored token it validates it against /auth/me and shows the user', async () => {
    session.save('tok', { id: 1, name: 'Cached' });
    const m = mockApi({ 'GET /auth/me': { ...USER, name: 'Fresh Name' } });
    renderAuth();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('user')).toHaveTextContent('Fresh Name');
    expect(m.calls[0].headers.Authorization).toBe('Bearer tok');
  });
  test('a stored token that the server rejects is discarded', async () => {
    session.save('expired', USER);
    vi.stubGlobal('location', { pathname: '/login', assign: vi.fn() });
    mockApi({ 'GET /auth/me': fail(401, { error: 'expired' }) });
    renderAuth();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(session.token).toBeNull();
  });
  test('login stores the token and user', async () => {
    const m = mockApi({ 'POST /auth/login': { token: 'new-token', user: USER } });
    renderAuth();
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent(USER.name));
    expect(m.calls[0].body).toEqual({ email: 'a@b.co', password: 'secret' });
    expect(session.token).toBe('new-token');
    expect(session.user).toEqual(USER);
  });
  test('a failed login rejects with the server message and leaves the user logged out', async () => {
    mockApi({ 'POST /auth/login': fail(401, { error: 'Invalid email or password' }) });
    renderAuth();
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(document.title).toBe('Invalid email or password'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
  test('register stores the new session; logout clears it', async () => {
    const m = mockApi({ 'POST /auth/register': { token: 't2', user: { ...USER, name: 'Ana' } } });
    renderAuth();
    await userEvent.click(screen.getByText('register'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Ana'));
    expect(m.calls[0].body).toEqual({ name: 'Ana', email: 'a@b.co', password: 'secret123' });
    await userEvent.click(screen.getByText('logout'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(session.token).toBeNull();
  });
});

function ModeProbe() {
  const { mode, toggle } = useColorMode();
  return <button onClick={toggle}>mode:{mode}</button>;
}
const renderMode = () => render(<ColorModeProvider><ModeProbe /><ColorModeToggle /></ColorModeProvider>);

describe('colour mode', () => {
  test('defaults to light', () => {
    renderMode();
    expect(screen.getByText('mode:light')).toBeInTheDocument();
  });
  test('follows the system preference when nothing is saved', () => {
    globalThis.__media.dark = true;
    renderMode();
    expect(screen.getByText('mode:dark')).toBeInTheDocument();
  });
  test('a saved choice wins over the system preference', () => {
    globalThis.__media.dark = true;
    localStorage.setItem('bikeledger.mode', 'light');
    renderMode();
    expect(screen.getByText('mode:light')).toBeInTheDocument();
  });
  test('an invalid saved value is ignored', () => {
    localStorage.setItem('bikeledger.mode', 'purple');
    renderMode();
    expect(screen.getByText('mode:light')).toBeInTheDocument();
  });
  test('toggling switches the mode, remembers it and updates the page background', async () => {
    renderMode();
    const bgLight = getComputedStyle(document.body).backgroundColor;
    await userEvent.click(screen.getByText('mode:light'));
    expect(screen.getByText('mode:dark')).toBeInTheDocument();
    expect(localStorage.getItem('bikeledger.mode')).toBe('dark');
    expect(getComputedStyle(document.body).backgroundColor).not.toBe(bgLight);
    await userEvent.click(screen.getByText('mode:dark'));
    expect(localStorage.getItem('bikeledger.mode')).toBe('light');
  });
  test('the toggle button describes what it will do and works', async () => {
    renderMode();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });
  test('still works when storage is unavailable', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    Object.defineProperty(window, 'localStorage', { value: broken, configurable: true });
    try {
      renderMode();
      await userEvent.click(screen.getByText('mode:light'));
      expect(screen.getByText('mode:dark')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
