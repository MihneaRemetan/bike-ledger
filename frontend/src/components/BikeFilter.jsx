import { MenuItem, TextField } from '@mui/material';

export default function BikeFilter({ bikes, value, onChange, sx }) {
  return (
    <TextField select size="small" label="Bike" value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 170, ...sx }}>
      <MenuItem value="">All bikes</MenuItem>
      {(bikes || []).map((b) => <MenuItem key={b.id} value={String(b.id)}>{b.name}</MenuItem>)}
    </TextField>
  );
}
