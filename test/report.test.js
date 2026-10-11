'use strict';

process.env.TZ = 'Europe/Stockholm';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const ical = require('node-ical');
const { buildReport, projectsIn, NO_PROJECT } = require('../lib/report');

const parsed = ical.sync.parseFile(path.join(__dirname, 'fixture.ics'));

test('hittar projektnummer i parentes', () => {
  assert.deepStrictEqual(projectsIn('Möte (#26035)'), ['26035']);
  assert.deepStrictEqual(projectsIn('A (# 1) B (#2) (#1)'), ['1', '2']);
  assert.deepStrictEqual(projectsIn('Utan nummer #26035'), []);
});

test('summerar timmar per projekt och kalender för vecka 41', () => {
  const from = new Date(2026, 9, 5); // mån 5 okt
  const to = new Date(2026, 9, 12);
  const r = buildReport([{ name: 'Anna', parsed }], from, to);
  const byId = Object.fromEntries(r.projects.map((p) => [p.id, p]));

  // Serien (daglig, 28 sep–7 okt) ger i veckan: mån 2 h, tis ändrad till 1 h, ons undantagen.
  // Samordningen har två projektnummer och delas lika (0,5 h var).
  assert.strictEqual(byId['26035'].total, 3.5 + 2 + 1 + 0.5);
  assert.strictEqual(byId['26101'].total, 0.5);
  assert.strictEqual(byId[NO_PROJECT].total, 0.5);
  assert.strictEqual(r.calendarTotals.Anna, 3.5 + 2 + 1 + 1 + 0.5);
  assert.strictEqual(byId['26035'].byCalendar.Anna, 7);
});

test('klipper händelser vid periodens gränser', () => {
  const from = new Date(2026, 9, 5, 9, 0);
  const to = new Date(2026, 9, 5, 10, 0);
  const r = buildReport([{ name: 'Anna', parsed }], from, to);
  assert.strictEqual(r.projects[0].total, 1);
});
