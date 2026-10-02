import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Chip, IconButton, Link, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import RouteIcon from '@mui/icons-material/RouteOutlined';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { fmtDate, fmtDuration, fmtElev, fmtKm } from '../lib/format';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import BikeFilter from '../components/BikeFilter';
import GpxImportDialog from '../components/GpxImportDialog';
import { useNotify } from '../components/Notify';
import { RideFormDialog } from '../components/forms';

export default function Rides() {
  const notify = useNotify();
  const [bikeId, setBikeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data: bikes } = useLoad(() => api('/bikes'), []);
  const { data: rides, loading, error, reload } = useLoad(() => api('/rides', { params: { bikeId, from, to } }), [bikeId, from, to]);
  const [dlg, setDlg] = useState(null);
  const [del, setDel] = useState(null);
  const close = () => setDlg(null);
  const saved = () => { close(); reload(); };
  const noBikes = !bikes?.length;

  return (
    <>
      <PageHeader
        title="Rides"
        subtitle="Every ride adds distance to the parts mounted on that bike. Log it by hand or import a GPX file."
        actions={
          <>
            <Button startIcon={<UploadIcon />} onClick={() => setDlg({ kind: 'gpx' })} disabled={noBikes}>Import GPX</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDlg({ kind: 'ride' })} disabled={noBikes}>Add ride</Button>
          </>
        }
      />
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <BikeFilter bikes={bikes} value={bikeId} onChange={setBikeId} />
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      </Box>
      {error && <Alert severity="error">{error.message}</Alert>}
      {loading && !rides && <Skeleton variant="rounded" height={200} />}
      {rides && (
        <Card>
          {rides.length === 0 ? (
            <EmptyState icon={<RouteIcon />} title="No rides" text={noBikes ? 'Add a bike first.' : 'Log a ride manually or import a GPX file.'} actionLabel={noBikes ? undefined : 'Add ride'} onAction={() => setDlg({ kind: 'ride' })} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell><TableCell>Title</TableCell><TableCell>Bike</TableCell>
                    <TableCell align="right">Distance</TableCell><TableCell align="right">Duration</TableCell>
                    <TableCell align="right">Elevation</TableCell><TableCell>Source</TableCell><TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rides.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</TableCell>
                      <TableCell>{r.title || '–'}</TableCell>
                      <TableCell><Link component={RouterLink} to={`/bikes/${r.bikeId}`}>{r.bikeName}</Link></TableCell>
                      <TableCell align="right">{fmtKm(r.distanceKm)}</TableCell>
                      <TableCell align="right">{fmtDuration(r.durationMin)}</TableCell>
                      <TableCell align="right">{fmtElev(r.elevationM)}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={r.source === 'GPX' ? 'GPX' : 'Manual'} /></TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton size="small" aria-label="Edit" onClick={() => setDlg({ kind: 'ride', item: r })}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label="Delete" onClick={() => setDel(r)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      <RideFormDialog open={dlg?.kind === 'ride'} ride={dlg?.item} bikes={bikes} defaultBikeId={bikeId} onClose={close} onSaved={saved} />
      <GpxImportDialog open={dlg?.kind === 'gpx'} bikes={bikes} defaultBikeId={bikeId} onClose={close} onSaved={saved} />
      <ConfirmDialog
        open={Boolean(del)}
        title="Delete ride?"
        text="Component wear will be recalculated without this ride."
        onClose={() => setDel(null)}
        onConfirm={async () => {
          try {
            await api(`/rides/${del.id}`, { method: 'DELETE' });
            notify.success('Ride deleted');
            setDel(null);
            reload();
          } catch (e) {
            notify.error(e.message);
          }
        }}
      />
    </>
  );
}
