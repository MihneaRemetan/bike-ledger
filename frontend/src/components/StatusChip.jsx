import { Chip } from '@mui/material';
import { RULE_STATUS_COLOR, RULE_STATUS_LABELS, STATUS_LABELS } from '../lib/constants';

// Shows a part status (OK, WARN, REPLACE, RETIRED) or a maintenance rule status (OK, DUE, OVERDUE, PAUSED)
export default function StatusChip({ status, rule }) {
  const color = rule ? RULE_STATUS_COLOR[status] : status;
  return (
    <Chip
      size="small"
      label={(rule ? RULE_STATUS_LABELS : STATUS_LABELS)[status] || status}
      sx={(t) => ({ bgcolor: t.palette.status[color] || t.palette.status.RETIRED, color: '#fff', fontWeight: 600 })}
    />
  );
}
