const json = (schema) => ({ 'application/json': { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const q = (name, type = 'string', extra = {}) => ({ name, in: 'query', schema: { type, ...extra } });
const errors = {
  400: { description: 'Validation failed', content: json(ref('Error')) },
  401: { description: 'Missing or invalid token', content: json(ref('Error')) },
  404: { description: 'Not found (also for resources of other users)', content: json(ref('Error')) },
};
const op = (tag, summary, { params = [], body, ok = 200, okSchema, secure = true, multipart } = {}) => ({
  tags: [tag],
  summary,
  ...(secure ? { security: [{ bearerAuth: [] }] } : { security: [] }),
  parameters: params,
  ...(body && { requestBody: { required: true, content: json(body) } }),
  ...(multipart && { requestBody: { required: true, content: { 'multipart/form-data': { schema: multipart } } } }),
  responses: {
    [ok]: okSchema ? { description: 'OK', content: json(okSchema) } : { description: ok === 204 ? 'No content' : 'OK' },
    ...errors,
  },
});

const arr = (s) => ({ type: 'array', items: s });
const listParams = [q('bikeId', 'integer'), q('from', 'string', { format: 'date' }), q('to', 'string', { format: 'date' }), q('limit', 'integer', { minimum: 1, maximum: 500 })];

const crud = (tag, base, name, plural, extra = {}) => ({
  [`/${base}`]: {
    get: op(tag, `List ${plural}`, { params: extra.listParams || listParams, okSchema: arr(ref(name)) }),
    post: op(tag, `Create ${name.toLowerCase()}`, { body: ref(`${name}Input`), ok: 201, okSchema: ref(name) }),
  },
  [`/${base}/{id}`]: {
    get: op(tag, `Get ${name.toLowerCase()}`, { params: [idParam], okSchema: ref(name) }),
    put: op(tag, `Update ${name.toLowerCase()} (partial)`, { params: [idParam], body: ref(`${name}Input`), okSchema: ref(name) }),
    delete: op(tag, `Delete ${name.toLowerCase()}`, { params: [idParam], ok: 204 }),
  },
});

const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'BikeLedger API',
    version: '1.0.0',
    description:
      'Bike maintenance ledger. Component wear is computed on every read from the rides logged on the same bike while the part was mounted. Use **Authorize** with the token returned by login/register.',
  },
  servers: [{ url: '/api' }],
  tags: ['Auth', 'Bikes', 'Components', 'Rides', 'Services', 'Stats', 'System'].map((name) => ({ name })),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { error: str, details: arr({ type: 'object', properties: { field: str, message: str } }) } },
      User: { type: 'object', properties: { id: int, name: str, email: str, createdAt: str } },
      AuthResponse: { type: 'object', properties: { token: str, user: ref('User') } },
      Bike: {
        type: 'object',
        properties: {
          id: int, name: str, brand: str, model: str,
          type: { type: 'string', enum: ['ROAD', 'MTB', 'GRAVEL', 'CITY', 'OTHER'] },
          year: int, notes: str, totalKm: num, rideCount: int, maintenanceCost: num, activeComponents: int, alerts: int,
        },
      },
      BikeInput: {
        type: 'object', required: ['name', 'type'],
        properties: { name: str, brand: str, model: str, type: { type: 'string', enum: ['ROAD', 'MTB', 'GRAVEL', 'CITY', 'OTHER'] }, year: int, notes: str },
      },
      Component: {
        type: 'object',
        properties: {
          id: int, bikeId: int, bikeName: str,
          type: { type: 'string', enum: ['CHAIN', 'CASSETTE', 'CHAINRING', 'TYRE_FRONT', 'TYRE_REAR', 'BRAKE_PADS', 'BRAKE_ROTORS', 'CABLES', 'BAR_TAPE', 'OTHER'] },
          brand: str, model: str, installedAt: { type: 'string', format: 'date' }, retiredAt: { type: 'string', format: 'date', nullable: true },
          initialKm: num, maxKm: num, price: num, wearKm: num, wearPct: num, remainingKm: num,
          status: { type: 'string', enum: ['OK', 'WARN', 'REPLACE', 'RETIRED'] },
        },
      },
      ComponentInput: {
        type: 'object', required: ['bikeId', 'type', 'installedAt'],
        properties: {
          bikeId: int, type: str, brand: str, model: str, installedAt: { type: 'string', format: 'date' },
          initialKm: num, maxKm: { type: 'number', description: 'Defaults from the component type' }, price: num,
          retiredAt: { type: 'string', format: 'date' },
        },
      },
      Ride: {
        type: 'object',
        properties: {
          id: int, bikeId: int, bikeName: str, date: { type: 'string', format: 'date-time' }, title: str,
          distanceKm: num, durationMin: int, elevationM: int, source: { type: 'string', enum: ['MANUAL', 'GPX'] }, notes: str,
        },
      },
      RideInput: {
        type: 'object', required: ['bikeId', 'date', 'distanceKm'],
        properties: { bikeId: int, date: { type: 'string', format: 'date-time' }, title: str, distanceKm: num, durationMin: int, elevationM: int, notes: str },
      },
      Service: {
        type: 'object',
        properties: {
          id: int, bikeId: int, bikeName: str, componentId: { type: 'integer', nullable: true },
          componentType: str, componentBrand: str, componentModel: str,
          date: { type: 'string', format: 'date' }, type: { type: 'string', enum: ['REPLACE', 'CLEAN', 'ADJUST', 'REPAIR', 'INSPECTION'] },
          cost: num, notes: str, retiredComponentId: int, newComponent: ref('Component'),
        },
      },
      ServiceInput: {
        type: 'object', required: ['bikeId', 'date', 'type'],
        properties: {
          bikeId: int, componentId: int, date: { type: 'string', format: 'date' }, type: str, cost: num, notes: str,
          replacement: {
            type: 'object',
            description: 'Only with type REPLACE + componentId. Mounts a new part of the same type.',
            properties: { brand: str, model: str, maxKm: num, price: num },
          },
        },
      },
    },
  },
  paths: {
    '/health': { get: op('System', 'Health check', { secure: false, okSchema: { type: 'object', properties: { status: str } } }) },
    '/auth/register': { post: op('Auth', 'Create an account', { secure: false, ok: 201, okSchema: ref('AuthResponse'),
      body: { type: 'object', required: ['name', 'email', 'password'], properties: { name: str, email: str, password: { type: 'string', minLength: 8 } } } }) },
    '/auth/login': { post: op('Auth', 'Log in', { secure: false, okSchema: ref('AuthResponse'),
      body: { type: 'object', required: ['email', 'password'], properties: { email: str, password: str } } }) },
    '/auth/me': { get: op('Auth', 'Current user', { okSchema: ref('User') }) },
    ...crud('Bikes', 'bikes', 'Bike', 'bikes', { listParams: [] }),
    '/components/defaults': { get: op('Components', 'Default max km per component type', { okSchema: { type: 'object', additionalProperties: num } }) },
    ...crud('Components', 'components', 'Component', 'components', {
      listParams: [q('bikeId', 'integer'), q('status', 'string', { enum: ['active', 'retired'] }), q('limit', 'integer')],
    }),
    ...crud('Rides', 'rides', 'Ride', 'rides'),
    '/rides/import-gpx': {
      post: op('Rides', 'Import a GPX file as a ride (preview=true only computes values)', {
        ok: 201, okSchema: ref('Ride'),
        multipart: { type: 'object', required: ['file', 'bikeId'], properties: { file: { type: 'string', format: 'binary' }, bikeId: int, preview: { type: 'boolean' } } },
      }),
    },
    ...crud('Services', 'services', 'Service', 'services'),
    '/stats/dashboard': { get: op('Stats', 'Dashboard totals, 12-month series and wear alerts') },
  },
};
