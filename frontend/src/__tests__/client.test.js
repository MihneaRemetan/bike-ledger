import { api, ApiError, session } from '../api/client';
import { mockApi, fail } from '../test/utils';

describe('session', () => {
  test('save, read and clear the token and user', () => {
    expect(session.token).toBeNull();
    expect(session.user).toBeNull();
    session.save('tok', { id: 1, name: 'A' });
    expect(session.token).toBe('tok');
    expect(session.user).toEqual({ id: 1, name: 'A' });
    session.clear();
    expect(session.token).toBeNull();
    expect(session.user).toBeNull();
  });
  test('a corrupted stored user reads as null instead of throwing', () => {
    localStorage.setItem('bikeledger.user', '{not json');
    expect(session.user).toBeNull();
  });
});

describe('api()', () => {
  test('GET goes to /api, parses JSON and sends the bearer token when logged in', async () => {
    const m = mockApi({ 'GET /bikes': [{ id: 1 }] });
    expect(await api('/bikes')).toEqual([{ id: 1 }]);
    expect(m.calls[0].url).toBe('/api/bikes');
    expect(m.calls[0].headers.Authorization).toBeUndefined();
    session.save('abc', { id: 1 });
    await api('/bikes');
    expect(m.calls[1].headers.Authorization).toBe('Bearer abc');
  });
  test('JSON bodies are serialised with a content type', async () => {
    const m = mockApi({ 'POST /bikes': (c) => ({ echoed: c.body }) });
    const out = await api('/bikes', { method: 'POST', body: { name: 'X' } });
    expect(out).toEqual({ echoed: { name: 'X' } });
    expect(m.calls[0].headers['Content-Type']).toBe('application/json');
  });
  test('FormData is sent as is, without a JSON content type', async () => {
    const m = mockApi({ 'POST /rides/import-gpx': { ok: true } });
    const form = new FormData();
    form.append('bikeId', '1');
    await api('/rides/import-gpx', { method: 'POST', form });
    expect(m.calls[0].body).toBe(form);
    expect(m.calls[0].headers['Content-Type']).toBeUndefined();
  });
  test('params become a query string; empty ones are dropped', async () => {
    const m = mockApi({ 'GET /rides': [] });
    await api('/rides', { params: { bikeId: 3, from: '', to: null, limit: 10 } });
    expect(m.calls[0].url).toBe('/api/rides?bikeId=3&limit=10');
    await api('/rides', { params: { from: '', to: undefined } });
    expect(m.calls[1].url).toBe('/api/rides');
  });
  test('204 responses resolve to null', async () => {
    mockApi({ 'DELETE /bikes/1': null });
    expect(await api('/bikes/1', { method: 'DELETE' })).toBeNull();
  });
  test('errors become ApiError with status, message, details and a field map', async () => {
    mockApi({ 'POST /bikes': fail(400, { error: 'Validation failed', details: [{ field: 'name', message: 'Name is required' }, { field: 'year', message: 'Too low' }] }) });
    const err = await api('/bikes', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.message]).toEqual([400, 'Validation failed']);
    expect(err.details).toHaveLength(2);
    expect(err.fieldErrors).toEqual({ name: 'Name is required', year: 'Too low' });
  });
  test('an error without a body still gives a readable message', async () => {
    mockApi({ 'GET /x': fail(500, null) });
    const err = await api('/x').catch((e) => e);
    expect(err.message).toBe('Request failed (500)');
    expect(err.details).toEqual([]);
    expect(err.fieldErrors).toEqual({});
  });
  test('network failures are reported as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await api('/bikes').catch((e) => e);
    expect([err.status, err.message]).toEqual([0, 'Cannot reach the server']);
  });

  describe('401 handling', () => {
    let assign;
    beforeEach(() => {
      assign = vi.fn();
      vi.stubGlobal('location', { pathname: '/bikes', assign });
    });
    test('clears the session and sends the user to /login', async () => {
      session.save('old', { id: 1 });
      mockApi({ 'GET /bikes': fail(401, { error: 'Invalid or expired token' }) });
      await expect(api('/bikes')).rejects.toMatchObject({ status: 401 });
      expect(session.token).toBeNull();
      expect(assign).toHaveBeenCalledWith('/login');
    });
    test('does not redirect when already on /login or /register', async () => {
      vi.stubGlobal('location', { pathname: '/login', assign });
      mockApi({ 'GET /bikes': fail(401, { error: 'x' }) });
      await api('/bikes').catch(() => {});
      expect(assign).not.toHaveBeenCalled();
    });
    test('a wrong password on login is just an error: the session is kept and no redirect happens', async () => {
      session.save('keep', { id: 1 });
      mockApi({ 'POST /auth/login': fail(401, { error: 'Invalid email or password' }) });
      const err = await api('/auth/login', { method: 'POST', body: {} }).catch((e) => e);
      expect(err.message).toBe('Invalid email or password');
      expect(session.token).toBe('keep');
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
