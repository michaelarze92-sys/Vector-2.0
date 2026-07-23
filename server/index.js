const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { DB_PATH } = require('./db/connection');

if (!fs.existsSync(DB_PATH)) {
  console.error(
    `No database found at ${DB_PATH}.\n` +
    `Run "npm run setup" first (creates the schema and seeds venues/users).`
  );
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/users', require('./routes/users'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
