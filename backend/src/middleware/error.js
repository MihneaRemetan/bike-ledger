const { ZodError } = require('zod');
const { HttpError } = require('../lib/http');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 15 MB)' });
  if (err.name === 'MulterError') return res.status(400).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Resource already exists' });
  if (['23514', '23503', '22P02'].includes(err.code)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
