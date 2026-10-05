import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Card, IconButton, Link, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import BuildIcon from '@mui/icons-material/SettingsSuggestOutlined';
import MoveIcon from '@mui/icons-material/DriveFileMoveOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { COMPONENT_TYPES, label } from '../lib/constants';
import { fmtDate } from '../lib/format';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import DeleteDialog from '../components/DeleteDialog';
import BikeFilter from '../components/BikeFilter';
import WearBar from '../components/WearBar';
import { ComponentFormDialog, MoveComponentDialog } from '../components/forms';
import ComponentHistoryDialog from '../components/ComponentHistoryDialog';
import BuyMenu from '../components/BuyMenu';

export default function Components() {
  const [bikeId, setBikeId] = useState('');
  const [status, setStatus] = useState('active');
  const { data: bikes } = useLoad(() => api('/bikes'), []);
  const { data: items, loading, error, reload } = useLoad(
    () => api('/components', { params: { bikeId, status: status === 'all' ? '' : status } }),
    [bikeId, status]
  );
  const [form, setForm] = useState({ open: false, item: null });
  const [del, setDel] = useState(null);
  const [move, setMove] = useState(null);
  const [history, setHistory] = useState(null);
  const closeForm = () => setForm({ open: false, item: null });
  const bikeTypeOf = (id) => (bikes || []).find((b) => b.id === id)?.type;

  return (
    <>
      <PageHeader title="Components" subtitle="The parts mounted on your bikes. Wear grows with every ride; replace a part when it reaches its limit." actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ open: true, item: null })} disabled={!bikes?.length}>Add component</Button>} />
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <BikeFilter bikes={bikes} value={bikeId} onChange={setBikeId} />
        <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="retired">Retired</MenuItem>
          <MenuItem value="all">All</MenuItem>
        </TextField>
      </Box>
      {error && <Alert severity="error">{error.message}</Alert>}
      {loading && !items && <Skeleton variant="rounded" height={200} />}
      {items && (
        <Card>
          {items.length === 0 ? (
            <EmptyState icon={<BuildIcon />} title="No components" text="Add the parts mounted on your bikes to track their wear." actionLabel="Add component" onAction={() => setForm({ open: true, item: null })} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Type</TableCell><TableCell>Bike</TableCell><TableCell>Brand / Model</TableCell><TableCell>Installed</TableCell><TableCell>Wear</TableCell><TableCell align="right">Actions</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell>{label(COMPONENT_TYPES, c.type)}</TableCell>
                      <TableCell><Link component={RouterLink} to={`/bikes/${c.bikeId}`}>{c.bikeName}</Link></TableCell>
                      <TableCell>{[c.brand, c.model].filter(Boolean).join(' ') || '–'}</TableCell>
                      <TableCell>{fmtDate(c.installedAt)}</TableCell>
                      <TableCell><WearBar component={c} /></TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {!c.retiredAt && <BuyMenu component={c} bikeType={bikeTypeOf(c.bikeId)} />}
                        <IconButton size="small" aria-label="Part history" onClick={() => setHistory(c)}><HistoryIcon fontSize="small" /></IconButton>
                        {!c.retiredAt && bikes && bikes.length > 1 && (
                          <IconButton size="small" aria-label="Move to another bike" onClick={() => setMove(c)}><MoveIcon fontSize="small" /></IconButton>
                        )}
                        <IconButton size="small" aria-label="Edit" onClick={() => setForm({ open: true, item: c })}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label="Delete" onClick={() => setDel(c)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      <ComponentFormDialog open={form.open} component={form.item} bikes={bikes} defaultBikeId={bikeId} onClose={closeForm} onSaved={() => { closeForm(); reload(); }} />
      <MoveComponentDialog open={Boolean(move)} component={move} bikes={bikes} onClose={() => setMove(null)} onSaved={() => { setMove(null); reload(); }} />
      <ComponentHistoryDialog open={Boolean(history)} component={history} onClose={() => setHistory(null)} />
      <DeleteDialog
        item={del}
        path="/components"
        title="Delete component?"
        text="Its services stay in the history but are no longer linked to it."
        deletedMessage="Component deleted"
        onClose={() => setDel(null)}
        onDeleted={reload}
      />
    </>
  );
}
