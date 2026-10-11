'use strict';

// Datumgränser (vecka, månad) räknas i svensk tid om inget annat anges.
process.env.TZ = process.env.TZ || 'Europe/Stockholm';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ical = require('node-ical');
const { buildReport } = require('./lib/report');

const PORT = Number(process.env.PORT || 3000);
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 60);
const AUTH_USER = process.env.DASHBOARD_USER || 'admin';
const AUTH_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

function loadCalendars() {
  const raw = process.env.CALENDARS_JSON
    || fs.readFileSync(path.join(__dirname, 'calendars.json'), 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list) || !list.every((c) => c.name && c.url)) {
    throw new Error('Kalenderkonfigurationen ska vara en lista med { "name", "url" }');
  }
  return list;
}

const cache = new Map();

// fresh = true hoppar över cachen, t.ex. när någon öppnar dashboarden.
async function fetchCalendar(url, fresh) {
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < CACHE_SECONDS * 1000) return hit.parsed;
  const res = await fetch(url.replace(/^webcals?:\/\//i, 'https://'), {
    headers: { 'User-Agent': 'faktmall-tidsrapport' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = ical.sync.parseICS(await res.text());
  cache.set(url, { at: Date.now(), parsed });
  return parsed;
}

function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

async function report(query) {
  const from = parseDay(query.get('from'));
  const toDay = parseDay(query.get('to'));
  if (!from || !toDay || toDay < from) {
    return { status: 400, body: { error: 'Ange from och to som ÅÅÅÅ-MM-DD' } };
  }
  // "to" är inklusive: räkna till och med slutet av den dagen.
  const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1);

  const configured = loadCalendars();
  const results = await Promise.allSettled(configured.map((c) => fetchCalendar(c.url, query.get('fresh') === '1')));
  const calendars = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') calendars.push({ name: configured[i].name, parsed: r.value });
    else errors.push({ calendar: configured[i].name, error: r.reason.message });
  });

  return {
    status: 200,
    body: { ...buildReport(calendars, from, to), errors, fetchedAt: new Date().toISOString(), timeZone: process.env.TZ },
  };
}

function authorized(req) {
  if (!AUTH_PASSWORD) return true;
  const expected = Buffer.from(`Basic ${Buffer.from(`${AUTH_USER}:${AUTH_PASSWORD}`).toString('base64')}`);
  const given = Buffer.from(req.headers.authorization || '');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Tidsrapport"' });
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/report') {
      const { status, body } = await report(url.searchParams);
      return send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Hittades inte');
  } catch (err) {
    console.error(err);
    send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`Tidsrapport-dashboard: http://localhost:${PORT}`);
});
