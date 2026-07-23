const fs = require('fs');
const path = require('path');
const { getDb, DB_PATH } = require('./connection');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
const db = getDb();
db.exec(schema);
db.close();

console.log(`Schema applied to ${DB_PATH}`);
