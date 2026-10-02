import { Box, Button, Card, CardContent, LinearProgress, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/CheckCircle';

// Onboarding checklist shown on the dashboard until the user has a bike, parts and a ride.
export default function GettingStarted({ steps }) {
  const done = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);
  return (
    <Card sx={{ mb: 3, borderColor: 'primary.main' }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Get started with BikeLedger</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          BikeLedger tracks how worn each part of your bike is, based on the rides you log. Set it up in three steps.
        </Typography>
        <LinearProgress variant="determinate" value={(done / steps.length) * 100} sx={{ height: 8, borderRadius: 4, mb: 0.5 }} />
        <Typography variant="caption" color="text.secondary">{done} of {steps.length} done</Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          {steps.map((s, i) => (
            <Box key={s.title} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', opacity: s.done ? 0.65 : 1 }}>
              {s.done ? (
                <CheckIcon color="success" sx={{ mt: 0.25 }} />
              ) : (
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, mt: 0.25, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, bgcolor: (t) => (i === nextIndex ? t.palette.brand.main : t.palette.divider), color: i === nextIndex ? '#fff' : 'text.secondary' }}>
                  {i + 1}
                </Box>
              )}
              <Box sx={{ flexGrow: 1 }}>
                <Typography fontWeight={600}>{s.title}</Typography>
                <Typography variant="body2" color="text.secondary">{s.text}</Typography>
              </Box>
              {!s.done && (
                <Button size="small" variant={i === nextIndex ? 'contained' : 'outlined'} onClick={s.onClick} sx={{ flexShrink: 0 }}>
                  {s.action}
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
