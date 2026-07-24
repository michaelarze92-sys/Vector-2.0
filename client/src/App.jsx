import { useEffect, useState } from 'react';

export default function App() {
  const [health, setHealth] = useState(null);
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(setHealth).catch(e => setError(String(e)));
    fetch('/api/venues').then(r => r.json()).then(setVenues).catch(e => setError(String(e)));
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
      <h1>Casino Estate PM — Phase 0</h1>
      <p style={{ color: '#666' }}>
        This is a scaffold check, not the app yet. Once this page shows your venues,
        the API and database are wired up correctly and Phase 1 (task management, Gantt,
        dashboard) can build on top of it.
      </p>

      {error && <p style={{ color: 'crimson' }}>Error: {error} — is the server running (npm run dev in /server)?</p>}

      <h2>API health</h2>
      <pre>{health ? JSON.stringify(health) : 'loading…'}</pre>

      <h2>Venues ({venues ? venues.length : '…'})</h2>
      <ul>
        {venues && venues.map(v => (
          <li key={v.id}>
            <strong>{v.short_code}</strong> — {v.name} ({v.region})
          </li>
        ))}
      </ul>
    </div>
  );
}
