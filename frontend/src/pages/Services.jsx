import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Chip, IconButton, Link, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import ServiceIcon from '@mui/icons-material/HandymanOutlined';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { COMPONENT_TYPES, SERVICE_TYPES, label } from '../lib/constants';
import { fmtDate, fmtMoney } from '../lib/format';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import DeleteDialog from '../components/DeleteDialog';
import BikeFilter from '../components/BikeFilter';
import { ServiceFormDialog } from '../components/forms';

export default function Services() {
  const [bikeId, setBikeId] = useState('');
  const { data: bikes } = useLoad(() => api('/bikes'), []);
  const { data: items, loading, error, reload } = useLoad(() => api('/services', { params: { bikeId } }), [bikeId]);
  const [form, setForm] = useState({ open: false, item: null });
  const [del, setDel] = useState(null);
  const closeForm = () => setForm({ open: false, item: null });
  const noBikes = !bikes?.length;
  const preset = bikeId ? { bikeId } : undefined;

  return (
    <>
      <PageHeader title="Services" subtitle="Cleanings, repairs and replacements. Logging a replacement retires the old part and can mount a new one." actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ open: true, item: null })} disabled={noBikes}>Log service</Button>} />
      <Box sx={{ mb: 2 }}><BikeFilter bikes={bikes} value={bikeId} onChange={setBikeId} /></Box>
      {error && <Alert severity="error">{error.message}</Alert>}
      {loading && !items && <Skeleton variant="rounded" height={200} />}
      {items && (
        <Card>
          {items.length === 0 ? (
            <EmptyState icon={<ServiceIcon />} title="No services" text={noBikes ? 'Add a bike first.' : 'Log cleanings, repairs and part replacements.'} actionLabel={noBikes ? undefined : 'Log service'} onAction={() => setForm({ open: true, item: null })} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Date</TableCell><TableCell>Bike</TableCell><TableCell>Type</TableCell><TableCell>Component</TableCell><TableCell align="right">Cost</TableCell><TableCell>Notes</TableCell><TableCell align="right">Actions</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {items.map((s) => (
                    <TableRow key={s.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(s.date)}</TableCell>
                      <TableCell><Link component={RouterLink} to={`/bikes/${s.bikeId}`}>{s.bikeName}</Link></TableCell>
                      <TableCell><Chip size="small" label={label(SERVICE_TYPES, s.type)} /></TableCell>
                      <TableCell>{s.componentType ? [label(COMPONENT_TYPES, s.componentType), s.componentBrand, s.componentModel].filter(Boolean).join(' · ') : '–'}</TableCell>
                      <TableCell align="right">{fmtMoney(s.cost)}</TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>{s.notes || '–'}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton size="small" aria-label="Edit" onClick={() => setForm({ open: true, item: s })}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label="Delete" onClick={() => setDel(s)}><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      <ServiceFormDialog open={form.open} service={form.item} preset={preset} bikes={bikes} onClose={closeForm} onSaved={() => { closeForm(); reload(); }} />
      <DeleteDialog
        item={del}
        path="/services"
        title="Delete service?"
        text="A replaced component stays retired; only the service record is removed."
        deletedMessage="Service deleted"
        onClose={() => setDel(null)}
        onDeleted={reload}
      />
    </>
  );
}
