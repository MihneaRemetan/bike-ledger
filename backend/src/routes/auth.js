const express = require('express');
const bcrypt = require('bcryptjs');
const { one } = require('../db/pool');
const { ah, HttpError } = require('../lib/http');
const schemas = require('../lib/schemas');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const publicUser = ({ id, name, email, createdAt }) => ({ id, name, email, createdAt });

router.post(
  '/register',
  ah(async (req, res) => {
    const { name, email, password } = schemas.register.parse(req.body);
    const hash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await one(
        'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *',
        [name, email, hash]
      );
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'Email already registered');
      throw err;
    }
    res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  })
);

router.post(
  '/login',
  ah(async (req, res) => {
    const { email, password } = schemas.login.parse(req.body);
    const user = await one('SELECT * FROM users WHERE email = $1', [email]);
    const ok = user && (await bcrypt.compare(password, user.password));
    if (!ok) throw new HttpError(401, 'Invalid email or password');
    res.json({ token: signToken(user.id), user: publicUser(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const user = await one('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!user) throw new HttpError(401, 'User no longer exists');
    res.json(publicUser(user));
  })
);

module.exports = router;
