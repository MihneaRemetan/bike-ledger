import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from '../../pages/Login';
import Register from '../../pages/Register';
import Landing from '../../pages/Landing';
import { session } from '../../api/client';
import { renderWithProviders, mockApi, fail, USER } from '../../test/utils';

describe('Login page', () => {
  const setup = (routes = {}) => {
    const m = mockApi(routes);
    renderWithProviders(<Login />, { user: null, route: '/login' });
    return m;
  };
  test('shows the form, a link to register and no demo credentials', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/register');
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });
  test('logs in with the typed credentials and stores the session', async () => {
    const m = setup({ 'POST /auth/login': { token: 'tok', user: USER } });
    await userEvent.type(screen.getByLabelText(/^Email/), 'mihnea@test.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(session.token).toBe('tok'));
    expect(m.calls[0].body).toEqual({ email: 'mihnea@test.dev', password: 'secret123' });
  });
  test('wrong credentials show the server message and keep the form usable', async () => {
    setup({ 'POST /auth/login': fail(401, { error: 'Invalid email or password' }) });
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co');
    await userEvent.type(screen.getByLabelText(/^Password/), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(session.token).toBeNull();
  });
  test('the button is disabled while the request runs', async () => {
    let finish;
    setup({ 'POST /auth/login': () => new Promise((r) => { finish = () => r({ token: 't', user: USER }); }) });
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co');
    await userEvent.type(screen.getByLabelText(/^Password/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
    finish();
  });
  test('the header has the logo (a link home) and a theme toggle', () => {
    setup();
    expect(screen.getByText('BikeLedger').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: /Switch to dark mode/ })).toBeInTheDocument();
  });
});

describe('Register page', () => {
  const setup = (routes = {}) => {
    const m = mockApi(routes);
    renderWithProviders(<Register />, { user: null, route: '/register' });
    return m;
  };
  const fill = async (name = 'Ana', email = 'ana@test.dev', password = 'longenough1') => {
    await userEvent.type(screen.getByLabelText(/^Name/), name);
    await userEvent.type(screen.getByLabelText(/^Email/), email);
    await userEvent.type(screen.getByLabelText(/^Password/), password);
  };
  test('shows the form, the password hint and a link to log in', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Start tracking your bikes' })).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
  test('creates the account and stores the session', async () => {
    const m = setup({ 'POST /auth/register': { token: 'new', user: { ...USER, name: 'Ana' } } });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() => expect(session.token).toBe('new'));
    expect(m.calls[0].body).toEqual({ name: 'Ana', email: 'ana@test.dev', password: 'longenough1' });
  });
  test('field errors from the server appear under their fields', async () => {
    setup({ 'POST /auth/register': fail(400, { error: 'Validation failed', details: [{ field: 'email', message: 'Invalid email' }, { field: 'password', message: 'At least 8 characters' }] }) });
    await fill('Ana', 'bad', 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toBeInvalid();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  test('an already registered email shows a message at the top', async () => {
    setup({ 'POST /auth/register': fail(409, { error: 'Email already registered' }) });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
  });
});

describe('Landing page', () => {
  const setup = () => renderWithProviders(<Landing />, { user: null, route: '/' });
  test('explains the product with a headline and a description', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Know when your bike parts wear out/);
    expect(screen.getByText(/maintenance logbook for cyclists/)).toBeInTheDocument();
  });
  test('shows every feature', () => {
    setup();
    for (const t of ['Automatic wear tracking', 'One-step replacements', 'GPX import', 'Maintenance costs', 'Dashboard & alerts', 'Private by design']) expect(screen.getByText(t)).toBeInTheDocument();
  });
  test('shows an example wear overview with all three states', () => {
    setup();
    expect(screen.getByLabelText('Example of component wear tracking')).toBeInTheDocument();
    for (const s of ['Wearing out', 'Replace now', 'OK']) expect(screen.getByText(s)).toBeInTheDocument();
  });
  test('call-to-action links go to register and login', () => {
    setup();
    const links = (name) => screen.getAllByRole('link', { name }).map((a) => a.getAttribute('href'));
    expect(links('Sign up')).toContain('/register');
    expect(links("Get started, it's free")).toEqual(['/register']);
    expect(links('Create your account')).toEqual(['/register']);
    expect(links('Log in').every((h) => h === '/login')).toBe(true);
  });
  test('has a theme toggle and a footer', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(localStorage.getItem('bikeledger.mode')).toBe('dark');
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} BikeLedger`))).toBeInTheDocument();
  });
  test('no longer has a "How it works" section', () => {
    setup();
    expect(screen.queryByText('How it works')).not.toBeInTheDocument();
  });
});
