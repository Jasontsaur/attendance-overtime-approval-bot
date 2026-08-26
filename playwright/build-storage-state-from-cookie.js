// Bootstraps auth/storage_state.json directly from a `document.cookie`
// string copied out of the user's already-logged-in Edge session (via the
// 讀Cookie bookmarklet + get-clipboard.sh), instead of doing the full
// interactive login-once.js flow. User-authorized one-off shortcut for when
// nobody can physically/RDP into the machine to type credentials.
//
// Usage: node build-storage-state-from-cookie.js '<cookie string>'
//
// Caveat: document.cookie never exposes HttpOnly cookies, so if the site
// ever adds an HttpOnly auth cookie this approach silently misses it. It
// also doesn't tell us each cookie's real domain/path/expiry — we assume
// host-only, path=/, session-lifetime, which matches how classic-ASP
// ASPSESSIONID cookies are normally set.
const fs = require('fs');
const path = require('path');

const cookieString = process.argv[2];
if (!cookieString) {
  console.error('Usage: node build-storage-state-from-cookie.js "<document.cookie string>"');
  process.exit(1);
}

// Set this to your organization's attendance-system hostname, e.g. via
// `ATTENDANCE_DOMAIN=attendance.example.com node build-storage-state-from-cookie.js '...'`.
const DOMAIN = process.env.ATTENDANCE_DOMAIN || 'YOUR-ATTENDANCE-SYSTEM.example.com';
const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storage_state.json');

const cookies = cookieString.split(';').map((pair) => {
  const idx = pair.indexOf('=');
  const rawName = pair.slice(0, idx).trim();
  const rawValue = pair.slice(idx + 1).trim();
  return {
    name: decodeURIComponent(rawName),
    value: decodeURIComponent(rawValue),
    domain: DOMAIN,
    path: '/',
    expires: -1, // session cookie
    httpOnly: false, // document.cookie can't see HttpOnly ones anyway
    secure: true,
    sameSite: 'Lax',
  };
});

const storageState = { cookies, origins: [] };

fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));
fs.chmodSync(STORAGE_STATE_PATH, 0o600);

console.log(`Wrote ${cookies.length} cookies to ${STORAGE_STATE_PATH}`);
console.log(cookies.map((c) => c.name).join(', '));
