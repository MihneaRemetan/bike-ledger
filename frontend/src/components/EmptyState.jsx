import { Box, Button, Typography } from '@mui/material';

export default function EmptyState({ icon, title, text, actionLabel, onAction }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      {icon && <Box sx={{ fontSize: 48, mb: 1, '& svg': { fontSize: 48, opacity: 0.5 } }}>{icon}</Box>}
      <Typography variant="h6" color="text.primary">{title}</Typography>
      {text && <Typography variant="body2" sx={{ mb: 2 }}>{text}</Typography>}
      {actionLabel && <Button variant="contained" onClick={onAction}>{actionLabel}</Button>}
    </Box>
  );
}
