import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, session } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(session.user);
  const [ready, setReady] = useState(!session.token);

  useEffect(() => {
    if (!session.token) return;
    api('/auth/me')
      .then(setUser)
      .catch(() => {
        session.clear();
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const authenticate = useCallback(async (path, body) => {
    const { token, user: u } = await api(path, { method: 'POST', body });
    session.save(token, u);
    setUser(u);
    return u;
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      login: (email, password) => authenticate('/auth/login', { email, password }),
      register: (name, email, password) => authenticate('/auth/register', { name, email, password }),
      logout: () => {
        session.clear();
        setUser(null);
      },
    }),
    [user, ready, authenticate]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
