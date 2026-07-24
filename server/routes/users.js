const express = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY id').all();
  db.close();
  res.json(users);
});

module.exports = router;
