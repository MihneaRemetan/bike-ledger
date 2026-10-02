import { Box, Typography } from '@mui/material';

export default function PhotoBanner({ image, title, subtitle, position = 'center 65%', height = { xs: 170, md: 230 } }) {
  return (
    <Box
      sx={{
        mb: 3, borderRadius: 3, overflow: 'hidden', color: '#fff', height,
        display: 'flex', alignItems: 'flex-end', p: { xs: 2.5, md: 4 },
        backgroundImage: `linear-gradient(90deg, rgba(18,58,46,0.88) 0%, rgba(18,58,46,0.55) 55%, rgba(18,58,46,0.1) 100%), url(${image})`,
        backgroundSize: 'cover', backgroundPosition: position,
      }}
    >
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800, fontSize: { xs: '1.6rem', md: '2.1rem' } }}>{title}</Typography>
        {subtitle && <Typography sx={{ opacity: 0.92, mt: 0.5 }}>{subtitle}</Typography>}
      </Box>
    </Box>
  );
}
