import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import { api } from '../api/client';
import { fmtDate, fmtDuration, fmtElev, fmtKm } from '../lib/format';
import { useNotify } from './Notify';

export default function GpxImportDialog({ open, bikes, defaultBikeId, onClose, onSaved }) {
  const notify = useNotify();
  const input = useRef(null);
  const [bikeId, setBikeId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setBikeId(defaultBikeId ? String(defaultBikeId) : '');
      setFile(null);
      setPreview(null);
      setError('');
    }
  }, [open, defaultBikeId]);

  const send = (f, id, previewOnly) => {
    const form = new FormData();
    form.append('bikeId', id);
    if (previewOnly) form.append('preview', 'true');
    form.append('file', f);
    return api('/rides/import-gpx', { method: 'POST', form });
  };

  const runPreview = async (f, id) => {
    if (!f || !id) return;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      setPreview(await send(f, id, true));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const ride = await send(file, bikeId, false);
      notify.success('Ride imported from GPX');
      onSaved(ride);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const rows = preview && [
    ['Title', preview.title], ['Date', fmtDate(preview.date)], ['Distance', fmtKm(preview.distanceKm)],
    ['Duration', fmtDuration(preview.durationMin)], ['Elevation gain', fmtElev(preview.elevationM)],
  ];

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Import a ride from a file</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Typography variant="body2" color="text.secondary">
          From Strava: open the activity on strava.com, click the three dots menu, then <b>Export GPX</b>. Garmin Connect and most bike computers export GPX or TCX too. The route is also saved for the Map page.
        </Typography>
        <TextField select size="small" label="Bike" required value={bikeId}
          onChange={(e) => { setBikeId(e.target.value); runPreview(file, e.target.value); }}>
          {(bikes || []).map((b) => <MenuItem key={b.id} value={String(b.id)}>{b.name}</MenuItem>)}
        </TextField>
        <input ref={input} type="file" accept=".gpx,.tcx,.gz,.xml,application/gpx+xml" hidden
          onChange={(e) => { const f = e.target.files[0]; setFile(f || null); runPreview(f, bikeId); e.target.value = ''; }} />
        <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => input.current.click()}>
          {file ? file.name : 'Choose a GPX or TCX file'}
        </Button>
        {file && !bikeId && <Typography variant="body2" color="text.secondary">Pick a bike to see the preview.</Typography>}
        {rows && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0.5, columnGap: 3, p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
            {rows.map(([k, v]) => [
              <Typography key={k} variant="body2" color="text.secondary">{k}</Typography>,
              <Typography key={`${k}v`} variant="body2" fontWeight={600}>{v}</Typography>,
            ])}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || !preview}>Save ride</Button>
      </DialogActions>
    </Dialog>
  );
}
