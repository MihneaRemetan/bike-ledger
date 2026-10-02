import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { api } from '../api/client';
import { useLoad } from '../lib/useLoad';
import { COMPONENT_TYPES, SERVICE_TYPES, label } from '../lib/constants';
import { fmtDate, fmtKm, fmtMoney } from '../lib/format';
import StatusChip from './StatusChip';

// Where a part has been mounted, how far it went on each bike, and what was done to it
export default function ComponentHistoryDialog({ open, component, onClose }) {
  const { data, loading, error } = useLoad(() => (open && component ? api(`/components/${component.id}`) : Promise.resolve(null)), [open, component?.id]);
  const name = component ? [label(COMPONENT_TYPES, component.type), [component.brand, component.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '';
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>History: {name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error.message}</Alert>}
        {loading && !data && <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress /></Box>}
        {data && (
          <>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
              <StatusChip status={data.status} />
              <Typography variant="body2" color="text.secondary">
                {Math.round(data.wearKm)} / {Math.round(data.maxKm)} km in total · installed {fmtDate(data.installedAt)}
                {data.retiredAt ? ` · retired ${fmtDate(data.retiredAt)}` : ''}
              </Typography>
            </Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Mounted on</Typography>
            <Table size="small" sx={{ mb: 2 }}>
              <TableHead><TableRow><TableCell>Bike</TableCell><TableCell>From</TableCell><TableCell>Until</TableCell><TableCell align="right">Distance</TableCell></TableRow></TableHead>
              <TableBody>
                {data.mounts.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.bikeName}</TableCell>
                    <TableCell>{fmtDate(m.fromDate)}</TableCell>
                    <TableCell>{m.toDate ? fmtDate(m.toDate) : data.retiredAt ? fmtDate(data.retiredAt) : <Chip size="small" label="Now" />}</TableCell>
                    <TableCell align="right">{fmtKm(m.km)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Services on this part</Typography>
            {data.services.length === 0 ? (
              <Typography variant="body2" color="text.secondary">None yet.</Typography>
            ) : (
              <Table size="small">
                <TableBody>
                  {data.services.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{fmtDate(s.date)}</TableCell>
                      <TableCell>{label(SERVICE_TYPES, s.type)}</TableCell>
                      <TableCell align="right">{fmtMoney(s.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
