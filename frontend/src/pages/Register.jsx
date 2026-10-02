import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Link, TextField, Typography } from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import AuthCard from './AuthCard';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    try {
      await register(form.name, form.email, form.password);
    } catch (err) {
      setErrors(err.fieldErrors || {});
      if (!err.details?.length) setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Start tracking your bikes" subtitle="Create a free account in under a minute.">
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Name" value={form.name} onChange={set('name')} error={!!errors.name} helperText={errors.name} required />
        <TextField label="Email" type="email" value={form.email} onChange={set('email')} error={!!errors.email} helperText={errors.email} required />
        <TextField label="Password" type="password" value={form.password} onChange={set('password')} error={!!errors.password} helperText={errors.password || 'At least 8 characters'} required />
        <Button type="submit" variant="contained" size="large" disabled={busy}>Sign up</Button>
        <Typography variant="body2">
          Already registered? <Link component={RouterLink} to="/login">Log in</Link>
        </Typography>
      </Box>
    </AuthCard>
  );
}
