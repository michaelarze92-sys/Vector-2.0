/* Guards the one hole the hash-stamping can't close on its own.
 *
 * build.py stamps sw.js's CACHE_NAME with a hash of the built index.html, so a
 * developer can't forget to bump it. But that only helps if build.py actually ran.
 * Hand-edit index.html, or commit after a failed/skipped build, and sw.js would point
 * at a cache name for a file that no longer exists — installed phones would then have
 * no signal that anything changed, which is exactly the stuck-on-an-old-version trap.
 *
 * This recomputes the hash from the committed index.html and asserts sw.js matches, so
 * the drift is caught by the test suite instead of silently shipping.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '../../..');
let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed = true;
};

const indexPath = path.join(REPO, 'index.html');
const swPath = path.join(REPO, 'sw.js');

check('index.html exists', fs.existsSync(indexPath));
check('sw.js exists', fs.existsSync(swPath));
if (failed) process.exit(1);

const built = fs.readFileSync(indexPath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');

// must match stamp_service_worker() in build.py
const expected = crypto.createHash('sha256').update(built).digest('hex').slice(0, 12);
const m = sw.match(/const CACHE_NAME = 'estates-ledger-([^']*)'/);

check('sw.js declares a CACHE_NAME', !!m);
if (m) {
  check('CACHE_NAME matches the built index.html', m[1] === expected,
    m[1] === expected ? `estates-ledger-${expected}`
                      : `sw.js has ${m[1]}, index.html hashes to ${expected} — run: python3 src/ledger/build.py`);
  check('CACHE_NAME is not the unstamped placeholder', m[1] !== '__BUILD_ID__');
}

// the PWA files the manifest and service worker promise must actually be there
const manifestPath = path.join(REPO, 'manifest.json');
check('manifest.json exists', fs.existsSync(manifestPath));
if (fs.existsSync(manifestPath)) {
  const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  mf.icons.forEach((i) =>
    check(`manifest icon present: ${i.src}`, fs.existsSync(path.join(REPO, i.src))));
}
['./index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-512-maskable.png']
  .forEach((rel) =>
    check(`app-shell file present: ${rel}`, fs.existsSync(path.join(REPO, rel.replace('./', '')))));

// the built page must actually reference them, or none of the above matters
check('index.html links the manifest', /<link[^>]+rel="manifest"/.test(built));
check('index.html registers the service worker', /serviceWorker\.register\("sw\.js"\)/.test(built));

// and the Artifact build must NOT, since those files aren't deployed beside it
const slimPath = path.join(REPO, 'dist', 'estates-ledger-slim.html');
if (fs.existsSync(slimPath)) {
  const slim = fs.readFileSync(slimPath, 'utf8');
  // the registration is gated on the manifest <link>, so stripping the link disarms it
  check('slim build has no manifest link', !/<link[^>]+rel="manifest"/.test(slim));

  /* Only markup references matter: those fetch, and the icons aren't deployed beside the
     Artifact, so each one is a 404. Icon paths inside JS are inert here — the code that
     uses them is gated on the manifest link, which the slim build doesn't have. This
     check was "no icon-N.png anywhere" and correctly caught the notification code
     referencing icons; the fix was to gate that code, not to hide the string. */
  check('slim build fetches no icons', !/(?:href|src)\s*=\s*"[^"]*icon-\d+\.png/.test(slim));
  check('slim build cannot reach the notification path',
    /!!document\.querySelector\('link\[rel="manifest"\]'\)/.test(slim));
}

console.log(failed ? '\nBUILD INTEGRITY: FAILED' : '\nBUILD INTEGRITY: OK');
process.exit(failed ? 1 : 0);
