import { Box, Card, CardContent, Typography } from '@mui/material';
import BikeIcon from '@mui/icons-material/PedalBikeOutlined';

export default function AuthCard({ title, children }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, color: 'primary.main' }}>
            <BikeIcon fontSize="large" />
            <Typography variant="h5" color="primary">BikeLedger</Typography>
          </Box>
          <Typography variant="h6" sx={{ mb: 2 }}>{title}</Typography>
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}
