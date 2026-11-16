# Repro for cypress-io/cypress#35205 and #34969

On Windows 11 with Chrome, Cypress 16's native network path hangs when it rewrites a script of about 4 MB or more, served over HTTP or HTTPS (16 of 16 runs hung over TLS, 3 of 4 over plain HTTP/1.1). `Fetch.getResponseBody` never answers, the page target's CDP connection then terminates without reconnecting, and the paused request never completes. `pageLoadTimeout` never fires and the process never exits.

Smallest case: `.\bisect.ps1 -Only 02` (hangs, also with `$env:TLS_HTTP1='1'` and usually with `-PlainHttp`). It passes with `-Http1` (`forceHttp1: true`), with `-ExtraConfig modifyObstructiveCode=false`, or with `$env:APP_BUNDLE_MB='2'`.

We first saw it as a cross-origin OIDC login inside `cy.session()` that hangs on the first test (#34969). `repro.ps1` runs that full flow.

This project needs no external services. `server.js` starts two local servers on different origins. By default they use TLS with HTTP/2 and a self-signed certificate generated at startup; no key is stored in the repo. With `PLAIN_HTTP=1` they use plain HTTP/1.1.

| Origin | Role |
| --- | --- |
| `https://localhost:3000` | The app. An ~8 MB `main.js` with many `window.top` / `window.location` references (so Cypress rewrites it), plus 6 chunk scripts. With no token in `sessionStorage`, the app redirects to the IdP. On `?code=` it exchanges the code for a token, calls `/connect/userinfo` over CORS, and stores the token in `sessionStorage`. `/?noauth=1` loads the same bundle without any login. `/static` is a one-line HTML page. |
| `https://127.0.0.1:4000` | A fake OIDC IdP. `/connect/authorize` redirects to a sign-in page. The page has a two-step AJAX form: `POST /Account/Login` sends the username, then `POST /Account/SignIn` sends the password and sets the session cookie. The browser then goes back through `/connect/authorize` to the app with a single-use code. IdP responses send `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'self'` and `Cross-Origin-Embedder-Policy: require-corp`. |

The Cypress side mirrors a real suite:

- `chromeWebSecurity: false`, `numTestsKeptInMemory: 1`, `experimentalRunAllSpecs: true`
- `cy.session(['demo'], setup, { cacheAcrossSpecs: true, validate })` in a global `beforeEach`. `setup` visits `/`, follows the cross-origin redirect, fills both form steps and waits on `cy.intercept` aliases for the two cross-origin POSTs and `/connect/userinfo`. `validate` reads the token with `cy.getAllSessionStorage()`, which opens an automation iframe on every origin, including the IdP that sends `X-Frame-Options: DENY`. It then checks the token with `cy.request`.
- A global `cy.intercept` on `**/chunk-*.js*`
- 15 specs × 3 tests that each `cy.visit('/')`

## Run everything

Windows 11, PowerShell, Node 20+, Chrome stable:

```powershell
npm install
.\run-all.ps1
```

`run-all.ps1` runs every variant once (bundle sizes, TLS vs plain HTTP, HTTP/2 vs HTTP/1.1, `modifyObstructiveCode`, `forceHttp1`, and the full `cy.session` login flow) and prints a table of expected and actual results. A run that hangs is detected from the `terminal disconnect for target` line in its debug log and stopped about 10 seconds later, so the whole matrix takes a few minutes. Logs go to `logs\run-all\NN\`.

## Run single variants

```powershell
npm install
.\repro.ps1 -Runs 5
.\repro.ps1 -Runs 5 -Http1
.\bisect.ps1
.\bisect.ps1 -Http1
.\repro.ps1 -Runs 3 -PlainHttp
.\bisect.ps1 -PlainHttp
```

- `repro.ps1` runs the full suite (`cypress/e2e`) `-Runs` times, with `forceHttp1=false` (native path) or with `-Http1`.
- `bisect.ps1` runs the five specs in `cypress/bisect` one at a time, with no global login. Each goes one step further than the previous one: static page, app bundle without login, IdP page visited directly, login without `cy.session`, login inside `cy.session`. The first `HUNG` spec shows which step triggers the hang. `-Only 02` runs a single spec, `-ExtraConfig key=value` adds Cypress config, and `-Tag name` gives the run its own log folder.
- `-PlainHttp` runs either script against plain HTTP/1.1 servers, which rules out TLS, the self-signed certificate and HTTP/2.
- A run is recorded as `HUNG` about 10 seconds after its debug log shows `terminal disconnect for target`, or when `-RunTimeoutMinutes` (default 15) / `-SpecTimeoutMinutes` (default 4) runs out.

All three scripts stop any running `Cypress.exe`, and any Chrome started from a Cypress profile, before starting and after a `HUNG` run. Don't run them while another Cypress project is running. Ports 3000 and 4000 must be free, including dev servers running inside WSL: WSL forwards its ports to Windows `localhost`.

Logs go to `logs\<mode>\` (`native`, `http1`, `native-plain`, `bisect-native`, ...):

- `summary.txt`: one line per run or spec (`PASS`, `FAIL (exit N)` or `HUNG`)
- `<run>.log`: Cypress stdout
- `<run>.debug.txt`: `DEBUG` output (default `cypress:*`; change it with `-DebugNamespaces`)
- `cypress-info.txt` (`repro.ps1` only): Cypress, Chrome and OS versions

## Watch a hung run

```powershell
npm run serve
npx cypress open --e2e --browser chrome --config forceHttp1=false
```

Run the second command in another terminal while `npm run serve` is running, then click `spec-01.cy.js` in the window that opens. When it stops moving, take a screenshot of the runner (command log and AUT). In DevTools (F12) → Console, pick the AUT frame in the context dropdown and run `window.Cypress`. `undefined` means Cypress lost its injection in that page.

## Knobs

| Env var (server) | Default | Effect |
| --- | --- | --- |
| `PLAIN_HTTP` | unset | `1` serves plain HTTP/1.1 instead of TLS + HTTP/2 |
| `TLS_HTTP1` | unset | `1` serves TLS with HTTP/1.1 only (no HTTP/2) |
| `APP_BUNDLE_MB` | `8` | Size of the rewritten `main.js` |
| `APP_CHUNKS` | `6` | Number of chunk scripts per page load |
| `IDP_STRICT_HEADERS` | `1` | `0` drops the IdP's XFO / CSP / COEP headers |
