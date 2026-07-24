// Structural seed data only — no project/task/budget/compliance figures.
// Venue names and codes come from the existing Board SHE report; region/licence_type/
// current_rag are left blank for you to fill in via the app rather than guessed at here.
const { getDb } = require('./connection');

const VENUES = [
  { short_code: 'v1', name: 'The Empire (Leicester Sq)', region: 'London' },
  { short_code: 'v2', name: 'Metropolitan Mayfair', region: 'London' },
  { short_code: 'v3', name: 'Park Lane Club', region: 'London' },
  { short_code: 'v4', name: 'The Sportsman (Marble Arch)', region: 'London' },
  { short_code: 'v5', name: 'Alea Glasgow', region: 'Northern' },
  { short_code: 'v6', name: 'Manchester 235', region: 'Northern' },
  { short_code: 'v7', name: 'Alea Nottingham', region: 'Northern' },
];

const db = getDb();

const insertVenue = db.prepare(`
  INSERT INTO venues (short_code, name, region)
  VALUES (@short_code, @name, @region)
  ON CONFLICT(short_code) DO NOTHING
`);
for (const v of VENUES) insertVenue.run(v);

db.prepare(`
  INSERT INTO users (name, email, role)
  VALUES (?, ?, ?)
  ON CONFLICT(email) DO NOTHING
`).run('Michael Arze', 'michael.arze.92@gmail.com', 'Property & SHE Manager');

db.close();
console.log(`Seeded ${VENUES.length} venues and 1 user.`);
