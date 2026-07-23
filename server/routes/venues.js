const express = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const venues = db.prepare('SELECT * FROM venues ORDER BY short_code').all();
  db.close();
  res.json(venues);
});

module.exports = router;
