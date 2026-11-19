/**
 * WALLY – Google Sheets backend
 * ------------------------------------------------------------
 * 1. In your Google Sheet: Extensions → Apps Script
 * 2. Delete everything in Code.gs and paste this whole file
 * 3. Deploy → New deployment → Web app
 *      Execute as: Me      Who has access: Anyone
 * 4. Copy the Web app link (ends in /exec) and paste it into Wally
 *
 * Your data is stored in the tabs this script creates:
 *   Transactions, Budgets, Users, Sessions
 * Don't rename those tabs or reorder their columns.
 */

// ===== Settings =====
// After you (and anyone you want) have created an account, set this to false
// and redeploy (Deploy → Manage deployments → ✏️ → Version: New version → Deploy).
const ALLOW_NEW_ACCOUNTS = true;
const SESSION_DAYS = 180;        // how long a device stays logged in
const MAX_FAILED_LOGINS = 10;    // wrong passwords before a 15-minute lock

const COLS = {
  Transactions: ['id', 'username', 'type', 'amount', 'category', 'date', 'note', 'created', 'updated', 'deleted', 'rev'],
  Budgets: ['username', 'total', 'categories', 'updated', 'rev'],
  Users: ['username', 'salt', 'verifier', 'created'],
  Sessions: ['username', 'tokenHash', 'created'],
};

/** Optional: run once from the editor to create the tabs. */
function setup() { Object.keys(COLS).forEach(sh_); }

function doGet() { return out_({ ok: true, app: 'wally' }); }

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(req.action || '');
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!fn) fail_('Unknown request.');
    return out_(Object.assign({ ok: true }, fn(req)));
  } catch (err) {
    return out_({ ok: false, error: err.userMessage || ('Server error: ' + err.message), code: err.code || 'error' });
  }
}

const ACTIONS = {
  ping: () => ({ app: 'wally' }),

  // Returns the password salt for a username (a fake one if the user doesn't exist).
  salt: req => {
    const u = name_(req.username);
    const user = findUser_(u);
    return { salt: user ? user.salt : sha_(secret_() + ':' + u).slice(0, 32) };
  },

  register: req => {
    if (!ALLOW_NEW_ACCOUNTS) fail_('Creating new accounts is turned off for this Wally.');
    const u = name_(req.username);
    const salt = hex_(req.salt, 32), verifier = hex_(req.verifier, 64);
    return withLock_(() => {
      if (findUser_(u)) fail_('That username is already taken.');
      append_('Users', [[t_(u), t_(salt), t_(sha_(verifier)), new Date()]]);
      return { username: u, token: newSession_(u) };
    });
  },

  login: req => {
    const u = name_(req.username);
    const verifier = hex_(req.verifier, 64);
    const cache = CacheService.getScriptCache(), key = 'fail:' + u;
    const fails = Number(cache.get(key) || 0);
    if (fails >= MAX_FAILED_LOGINS) fail_('Too many wrong attempts. Try again in 15 minutes.');
    const user = findUser_(u);
    if (!user || user.verifier !== sha_(verifier)) {
      cache.put(key, String(fails + 1), 900);
      fail_('Wrong username or password.');
    }
    cache.remove(key);
    return withLock_(() => ({ username: u, token: newSession_(u) }));
  },

  logout: req => {
    const s = auth_(req);
    withLock_(() => { const r = findSession_(s.hash); if (r) sh_('Sessions').deleteRow(r.row); });
    CacheService.getScriptCache().remove('tok:' + s.hash);
    return {};
  },

  // Two-way sync: saves the device's changes, returns everything changed since `since`.
  sync: req => {
    const u = auth_(req).username;
    const since = Number(req.since) || 0;

    // newest version of each incoming record
    const incoming = {};
    (Array.isArray(req.changes) ? req.changes.slice(0, 500) : []).forEach(c => {
      const t = cleanTx_(c);
      if (t && (!incoming[t.id] || incoming[t.id].updated < t.updated)) incoming[t.id] = t;
    });

    return withLock_(() => {
      const rev = nextRev_();
      const sheet = sh_('Transactions');
      const existing = {};
      rows_('Transactions').forEach((r, i) => {
        if (str_(r[1]) === u) existing[str_(r[0])] = { row: i + 2, updated: Number(r[8]) || 0 };
      });
      const appends = [];
      Object.keys(incoming).forEach(id => {
        const t = incoming[id], ex = existing[id];
        if (ex && ex.updated >= t.updated) return; // the sheet already has a newer version
        const row = [t_(t.id), t_(u), t_(t.type), t.amount, t_(t.category), t_(t.date), t_(t.note),
                     t.created, t.updated, t.deleted, rev];
        if (ex) sheet.getRange(ex.row, 1, 1, row.length).setValues([row]);
        else appends.push(row);
      });
      if (appends.length) append_('Transactions', appends);

      // budget (one row per user)
      const b = cleanBudget_(req.budget);
      const bRows = rows_('Budgets');
      let bi = bRows.findIndex(r => str_(r[0]) === u);
      if (b && (bi < 0 || Number(bRows[bi][3]) < b.updated)) {
        const row = [t_(u), b.total, t_(JSON.stringify(b.cats)), b.updated, rev];
        if (bi >= 0) { sh_('Budgets').getRange(bi + 2, 1, 1, row.length).setValues([row]); bRows[bi] = row; }
        else { append_('Budgets', [row]); bRows.push(row); bi = bRows.length - 1; }
      }
      let budget = null;
      if (bi >= 0 && Number(bRows[bi][4]) > since) {
        let cats = {};
        try { cats = JSON.parse(str_(bRows[bi][2]) || '{}'); } catch (x) {}
        budget = { total: Number(bRows[bi][1]) || 0, cats: cats, updated: Number(bRows[bi][3]) || 0 };
      }

      const changes = rows_('Transactions')
        .filter(r => str_(r[1]) === u && Number(r[10]) > since)
        .map(rowToTx_);

      return { serverTime: rev, changes: changes, budget: budget, sheetUrl: SpreadsheetApp.getActive().getUrl() };
    });
  },
};

// ===== Auth helpers =====
function auth_(req) {
  const u = name_(req.username);
  const token = String(req.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) fail_('Please log in again.', 'auth');
  const hash = sha_(token), cache = CacheService.getScriptCache();
  if (cache.get('tok:' + hash) === u) return { username: u, hash: hash };
  const s = findSession_(hash);
  if (!s || s.username !== u || Date.now() - s.created > SESSION_DAYS * 864e5 || !findUser_(u)) {
    fail_('Your login has expired. Please log in again.', 'auth');
  }
  cache.put('tok:' + hash, u, 600);
  return { username: u, hash: hash };
}

function newSession_(u) {
  const token = sha_(Utilities.getUuid() + Utilities.getUuid() + Date.now());
  append_('Sessions', [[t_(u), t_(sha_(token)), new Date()]]);
  return token;
}

function findUser_(u) {
  const rows = rows_('Users');
  for (let i = 0; i < rows.length; i++) {
    if (str_(rows[i][0]) === u) return { row: i + 2, salt: str_(rows[i][1]), verifier: str_(rows[i][2]) };
  }
  return null;
}

function findSession_(hash) {
  const rows = rows_('Sessions');
  for (let i = 0; i < rows.length; i++) {
    if (str_(rows[i][1]) === hash) return { row: i + 2, username: str_(rows[i][0]), created: new Date(rows[i][2]).getTime() || 0 };
  }
  return null;
}

// ===== Validation =====
function name_(v) {
  const u = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(u)) fail_('Username must be 3–30 letters, numbers, . _ or -');
  return u;
}
function hex_(v, len) {
  const s = String(v || '');
  if (s.length !== len || !/^[a-f0-9]+$/.test(s)) fail_('Bad request.');
  return s;
}
function cleanTx_(c) {
  if (!c || typeof c !== 'object') return null;
  const id = String(c.id || ''), amount = Math.round(Number(c.amount) * 100) / 100;
  const category = String(c.category || '').slice(0, 40), date = String(c.date || '');
  if (!/^[a-z0-9]{6,40}$/i.test(id)) return null;
  if (c.type !== 'income' && c.type !== 'expense') return null;
  if (!(amount > 0 && amount < 1e9) || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    id: id, type: c.type, amount: amount, category: category, date: date,
    note: String(c.note || '').slice(0, 80),
    created: Number(c.created) || Date.now(), updated: Number(c.updated) || Date.now(),
    deleted: c.deleted === true,
  };
}
function cleanBudget_(b) {
  if (!b || typeof b !== 'object') return null;
  const cats = {};
  Object.keys(b.cats || {}).slice(0, 30).forEach(k => {
    const v = Math.round(Number(b.cats[k]) * 100) / 100;
    if (k.length <= 40 && v > 0 && v < 1e9) cats[k] = v;
  });
  const total = Math.round(Number(b.total) * 100) / 100;
  return { total: total > 0 && total < 1e9 ? total : 0, cats: cats, updated: Number(b.updated) || Date.now() };
}
function rowToTx_(r) {
  return {
    id: str_(r[0]), type: str_(r[2]), amount: Number(r[3]) || 0, category: str_(r[4]),
    date: r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'yyyy-MM-dd') : str_(r[5]),
    note: str_(r[6]), created: Number(r[7]) || 0, updated: Number(r[8]) || 0,
    deleted: r[9] === true || String(r[9]).toUpperCase() === 'TRUE',
  };
}

// ===== Sheet helpers =====
function sh_(name) {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    const cols = COLS[name];
    s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    s.setFrozenRows(1);
    if (name === 'Transactions') {
      s.getRange(2, 4, s.getMaxRows() - 1, 1).setNumberFormat('0.00');
      s.getRange(2, 8, s.getMaxRows() - 1, 2).setNumberFormat('0');
      s.getRange(2, 11, s.getMaxRows() - 1, 1).setNumberFormat('0');
    }
    if (name === 'Budgets') {
      s.getRange(2, 2, s.getMaxRows() - 1, 1).setNumberFormat('0.00');
      s.getRange(2, 4, s.getMaxRows() - 1, 2).setNumberFormat('0');
    }
  }
  return s;
}
function rows_(name) {
  const s = sh_(name), n = s.getLastRow();
  return n < 2 ? [] : s.getRange(2, 1, n - 1, COLS[name].length).getValues();
}
function append_(name, rows) {
  const s = sh_(name), start = s.getLastRow() + 1;
  const extra = start + rows.length - 1 - s.getMaxRows();
  if (extra > 0) s.insertRowsAfter(s.getMaxRows(), extra);
  s.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

// ===== Misc =====
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('Wally is busy. Please try again.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function nextRev_() {
  const p = PropertiesService.getScriptProperties();
  const rev = Math.max(Date.now(), Number(p.getProperty('rev') || 0) + 1);
  p.setProperty('rev', String(rev));
  return rev;
}
function secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('secret');
  if (!s) { s = sha_(Utilities.getUuid() + Utilities.getUuid()); p.setProperty('secret', s); }
  return s;
}
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function t_(s) { s = String(s); return s === '' ? '' : "'" + s; } // store as plain text (also blocks formulas)
function str_(v) { return String(v === null || v === undefined ? '' : v).replace(/^'/, ''); }
function fail_(msg, code) { const e = new Error(msg); e.userMessage = msg; e.code = code || 'error'; throw e; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
