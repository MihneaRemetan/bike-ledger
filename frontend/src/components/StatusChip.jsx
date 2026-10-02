import { Chip } from '@mui/material';
import { STATUS_LABELS } from '../lib/constants';

export default function StatusChip({ status }) {
  return (
    <Chip
      size="small"
      label={STATUS_LABELS[status] || status}
      sx={(t) => ({ bgcolor: t.palette.status[status], color: '#fff', fontWeight: 600 })}
    />
  );
}
