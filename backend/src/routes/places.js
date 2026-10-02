const express = require('express');
const { z } = require('zod');
const { ah } = require('../lib/http');
const { findBikeShops } = require('../lib/overpass');

const router = express.Router();

const shopsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radiusKm: z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().min(1).max(30).default(10)),
});

router.get(
  '/bike-shops',
  ah(async (req, res) => {
    const q = shopsQuery.parse(req.query);
    res.json(await findBikeShops(q));
  })
);

module.exports = router;
