const express = require('express');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'BikeLedger API' }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/bikes', requireAuth, require('./routes/bikes'));
  app.use('/api/components', requireAuth, require('./routes/components'));
  app.use('/api/rides', requireAuth, require('./routes/rides'));
  app.use('/api/services', requireAuth, require('./routes/services'));
  app.use('/api/stats', requireAuth, require('./routes/stats'));
  app.use('/api/places', requireAuth, require('./routes/places'));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
