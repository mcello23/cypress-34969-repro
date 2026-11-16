const http = require('node:http');
const https = require('node:https');
const http2 = require('node:http2');
const crypto = require('node:crypto');
const selfsigned = require('selfsigned');

const PLAIN_HTTP = process.env.PLAIN_HTTP === '1';
const TLS_HTTP1 = !PLAIN_HTTP && process.env.TLS_HTTP1 === '1';
const SCHEME = PLAIN_HTTP ? 'http' : 'https';
const APP_PORT = Number(process.env.APP_PORT || 3000);
const IDP_PORT = Number(process.env.IDP_PORT || 4000);
const APP = `${SCHEME}://localhost:${APP_PORT}`;
const IDP = `${SCHEME}://127.0.0.1:${IDP_PORT}`;
const BUNDLE_MB = Number(process.env.APP_BUNDLE_MB || 8);
const CHUNKS = Number(process.env.APP_CHUNKS || 6);
const STRICT_IDP_HEADERS = process.env.IDP_STRICT_HEADERS !== '0';
const PARENT_PID = Number(process.env.REPRO_PARENT_PID || 0);

if (PARENT_PID) {
  setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      process.exit(0);
    }
  }, 2000);
}

const SESSION_COOKIE = PLAIN_HTTP
  ? 'idp_session=valid; Path=/; HttpOnly; SameSite=Lax'
  : 'idp_session=valid; Path=/; Secure; HttpOnly; SameSite=None';

const pems = PLAIN_HTTP
  ? null
  : selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      days: 30,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' }
          ]
        }
      ]
    });

function createServer(handler) {
  if (PLAIN_HTTP) {
    return http.createServer(handler);
  }
  if (TLS_HTTP1) {
    return https.createServer({ key: pems.private, cert: pems.cert }, handler);
  }
  return http2.createSecureServer({ key: pems.private, cert: pems.cert, allowHTTP1: true }, handler);
}

const tokens = new Set();
const codes = new Set();

function buildPadding(targetBytes) {
  const lines = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i++) {
    const line = `function pad${i}(a){if(window.top!==window.self){return a}return window.location.href.length+a+${i}}\n`;
    lines.push(line);
    size += line.length;
  }
  return lines.join('');
}

const appLogic = `
(function () {
  var IDP = ${JSON.stringify(IDP)};
  var CHUNKS = ${CHUNKS};
  function show(text) { document.getElementById('status').textContent = text; }
  function ready(text) { document.body.setAttribute('data-ready', '1'); show(text); }
  for (var c = 1; c <= CHUNKS; c++) {
    var s = document.createElement('script');
    s.src = '/chunk-' + c + '.js?v=' + Date.now();
    document.head.appendChild(s);
  }
  var params = new URLSearchParams(location.search);
  var stored = sessionStorage.getItem('oidc.user');
  function authorize() {
    location.href = IDP + '/connect/authorize?client_id=app&redirect_uri=' + encodeURIComponent(location.origin + '/');
  }
  if (params.get('noauth')) {
    ready('NoAuth');
    return;
  }
  if (params.get('code')) {
    fetch(IDP + '/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=' + encodeURIComponent(params.get('code'))
    })
      .then(function (r) { return r.json(); })
      .then(function (t) {
        if (!t.access_token) {
          throw new Error('code exchange failed');
        }
        sessionStorage.setItem('oidc.user', JSON.stringify({ access_token: t.access_token, expires_at: Date.now() + 3600000 }));
        history.replaceState(null, '', '/');
        return fetch(IDP + '/connect/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } });
      })
      .then(function (r) { return r.json(); })
      .then(function (u) { ready('Hello ' + u.name); })
      .catch(function () {
        history.replaceState(null, '', '/');
        if (sessionStorage.getItem('oidc.user')) {
          ready('Ready');
        } else {
          authorize();
        }
      });
    return;
  }
  if (!stored) {
    authorize();
    return;
  }
  fetch('/api/profile', { headers: { Authorization: 'Bearer ' + JSON.parse(stored).access_token } }).then(function (r) {
    if (r.ok) {
      ready('Ready');
    } else {
      sessionStorage.removeItem('oidc.user');
      location.reload();
    }
  });
})();
`;

const appBundle = buildPadding(BUNDLE_MB * 1024 * 1024) + appLogic;
const chunk = buildPadding(200 * 1024);

const appHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Repro app</title></head>
<body>
<div id="status">Loading...</div>
<script src="/main.js"></script>
</body>
</html>`;

const loginHtml = returnUrl => `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Repro IdP sign in</title></head>
<body>
<h1>Sign in</h1>
<form id="loginForm" method="post" action="/Account/Login">
  <div id="step"><label>User <input id="Username" name="Username" autocomplete="off"></label></div>
  <button type="submit">Next</button>
</form>
<script>
(function () {
  var returnUrl = ${JSON.stringify(returnUrl)};
  var form = document.getElementById('loginForm');
  var stage = 'user';
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (stage === 'user') {
      var user = document.getElementById('Username').value;
      fetch('/Account/Login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'Username=' + encodeURIComponent(user) })
        .then(function (r) { return r.json(); })
        .then(function () {
          stage = 'password';
          document.getElementById('step').innerHTML = '<label>Password <input id="Password" name="Password" type="password"></label>';
        });
      return;
    }
    var pass = document.getElementById('Password').value;
    fetch('/Account/SignIn', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'Password=' + encodeURIComponent(pass) })
      .then(function (r) { return r.json(); })
      .then(function (res) { location.href = res.redirect; });
  });
})();
</script>
</body>
</html>`;

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', d => (data += d));
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function idpHeaders(extra) {
  const strict = STRICT_IDP_HEADERS
    ? {
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'self'",
        'cross-origin-embedder-policy': 'require-corp'
      }
    : {};
  return { 'cache-control': 'no-store', ...strict, ...extra };
}

function cors(extra) {
  return {
    'access-control-allow-origin': APP,
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
    ...extra
  };
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

const app = createServer((req, res) => {
  const url = new URL(req.url, APP);
  if (url.pathname === '/') {
    return send(res, 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, appHtml);
  }
  if (url.pathname === '/static') {
    return send(res, 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, '<!doctype html><h1 id="static">static ok</h1>');
  }
  if (url.pathname === '/main.js') {
    return send(res, 200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }, appBundle);
  }
  if (/^\/chunk-\d+\.js$/.test(url.pathname)) {
    return send(res, 200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }, chunk);
  }
  if (url.pathname === '/api/profile') {
    const ok = tokens.has(bearer(req));
    return send(res, ok ? 200 : 401, { 'content-type': 'application/json' }, JSON.stringify({ ok }));
  }
  return send(res, 404, { 'content-type': 'text/plain' }, 'not found');
});

const idp = createServer(async (req, res) => {
  const url = new URL(req.url, IDP);
  if (req.method === 'OPTIONS') {
    return send(res, 204, cors(), '');
  }
  if (url.pathname === '/connect/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri') || `${APP}/`;
    const signedIn = /(?:^|;\s*)idp_session=valid/.test(req.headers.cookie || '');
    if (!signedIn) {
      const returnUrl = `${url.pathname}${url.search}`;
      return send(res, 302, idpHeaders({ location: `/Account/Login?ReturnUrl=${encodeURIComponent(returnUrl)}` }), '');
    }
    const code = crypto.randomUUID();
    codes.add(code);
    return send(res, 302, idpHeaders({ location: `${redirectUri}?code=${code}` }), '');
  }
  if (url.pathname === '/Account/Login' && req.method === 'GET') {
    const returnUrl = url.searchParams.get('ReturnUrl') || '/connect/authorize';
    return send(res, 200, idpHeaders({ 'content-type': 'text/html; charset=utf-8' }), loginHtml(returnUrl));
  }
  if (url.pathname === '/Account/Login' && req.method === 'POST') {
    await readBody(req);
    return send(res, 200, idpHeaders({ 'content-type': 'application/json' }), JSON.stringify({ next: 'password' }));
  }
  if (url.pathname === '/Account/SignIn' && req.method === 'POST') {
    await readBody(req);
    const referer = new URL(req.headers.referer || `${IDP}/Account/Login`);
    const returnUrl = referer.searchParams.get('ReturnUrl') || '/connect/authorize';
    return send(
      res,
      200,
      idpHeaders({
        'content-type': 'application/json',
        'set-cookie': SESSION_COOKIE
      }),
      JSON.stringify({ redirect: returnUrl })
    );
  }
  if (url.pathname === '/connect/token' && req.method === 'POST') {
    const body = await readBody(req);
    const code = body.get('code');
    if (!codes.delete(code)) {
      return send(res, 400, cors({ 'content-type': 'application/json' }), JSON.stringify({ error: 'invalid_grant' }));
    }
    const token = crypto.randomUUID();
    tokens.add(token);
    return send(res, 200, cors({ 'content-type': 'application/json' }), JSON.stringify({ access_token: token, expires_in: 3600 }));
  }
  if (url.pathname === '/connect/userinfo') {
    const ok = tokens.has(bearer(req));
    return send(res, ok ? 200 : 401, cors({ 'content-type': 'application/json' }), JSON.stringify(ok ? { name: 'demo' } : { error: 'invalid_token' }));
  }
  return send(res, 404, idpHeaders({ 'content-type': 'text/plain' }), 'not found');
});

app.listen(APP_PORT, () => console.log(`app  ${APP}  (${PLAIN_HTTP ? 'plain HTTP/1.1' : TLS_HTTP1 ? 'TLS, HTTP/1.1 only' : 'TLS, HTTP/2'}, main.js ${(appBundle.length / 1048576).toFixed(1)} MB, ${CHUNKS} chunks)`));
idp.listen(IDP_PORT, () => console.log(`idp  ${IDP}  (strict headers: ${STRICT_IDP_HEADERS})`));
