import { useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import { api, download } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useNotify } from '../components/Notify';

const CSV = [
  ['bikes', 'Bikes'], ['components', 'Components'], ['rides', 'Rides'], ['services', 'Services'], ['rules', 'Maintenance rules'],
];

const summarize = (counts) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ') || 'nothing';

export default function DataPage() {
  const notify = useNotify();
  const input = useRef(null);
  const [tracks, setTracks] = useState(false);
  const [busy, setBusy] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null); // { ok: boolean, text: string }

  const get = async (key, path, fallback) => {
    setBusy(key);
    try {
      const name = await download(path, fallback);
      notify.success(`Downloaded ${name}`);
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const doImport = async () => {
    setBusy('import');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { imported } = await api('/data/import', { method: 'POST', form });
      setResult({ ok: true, text: `Imported ${summarize(imported)}.` });
      setFile(null);
    } catch (e) {
      const details = (e.details || []).slice(0, 5).map((d) => `${d.field}: ${d.message}`).join('; ');
      setResult({ ok: false, text: details ? `${e.message}. ${details}` : e.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHeader title="Data" subtitle="Download everything you logged, or load a backup. Your data stays yours." />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6">Export</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The JSON file contains everything and can be imported again. CSV files open in Excel or Google Sheets.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            <Button variant="contained" startIcon={<DownloadIcon />} disabled={Boolean(busy)}
              onClick={() => get('json', `/data/export${tracks ? '?tracks=true' : ''}`, 'bikeledger.json')}>
              Download everything (JSON)
            </Button>
            <FormControlLabel control={<Checkbox checked={tracks} onChange={(e) => setTracks(e.target.checked)} />} label="Include GPS tracks (bigger file)" />
          </Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Spreadsheets</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {CSV.map(([key, name]) => (
              <Button key={key} size="small" variant="outlined" startIcon={<DownloadIcon />} disabled={Boolean(busy)} onClick={() => get(key, `/data/export/${key}.csv`, `bikeledger-${key}.csv`)}>
                {name}
              </Button>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6">Import</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Adds the bikes, parts, rides, services and rules from a BikeLedger JSON export to your account.
            Nothing is merged: importing the same file twice creates duplicates.
          </Typography>
          <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); e.target.value = ''; }} />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => input.current.click()}>{file ? file.name : 'Choose import file'}</Button>
            <Button variant="contained" disabled={!file || Boolean(busy)} onClick={doImport}>Import</Button>
          </Box>
          {result && <Alert severity={result.ok ? 'success' : 'error'} sx={{ mt: 2 }}>{result.text}</Alert>}
        </CardContent>
      </Card>
    </>
  );
}
