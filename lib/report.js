'use strict';

const ical = require('node-ical');

// Projektnummer skrivs i parentes i händelsens titel, t.ex. "Möte kund (#26035)".
const PROJECT_RE = /\(\s*#\s*(\d+)\s*\)/g;
const NO_PROJECT = 'Utan projekt';

function text(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return String(value.val ?? '');
}

function projectsIn(summary) {
  const ids = new Set();
  for (const m of text(summary).matchAll(PROJECT_RE)) ids.add(m[1]);
  return [...ids];
}

// Alla tidsatta förekomster av kalenderns händelser som överlappar [from, to).
// Heldagshändelser och inställda händelser räknas inte som arbetad tid.
function instancesInRange(parsed, from, to) {
  const out = [];
  for (const ev of Object.values(parsed)) {
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    const instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    for (const inst of instances) {
      if (inst.isFullDay) continue;
      if (String(inst.event?.status || ev.status || '').toUpperCase() === 'CANCELLED') continue;
      const start = new Date(Math.max(inst.start.getTime(), from.getTime()));
      const end = new Date(Math.min((inst.end || inst.start).getTime(), to.getTime()));
      if (end <= start) continue;
      out.push({ summary: text(inst.summary), start, end });
    }
  }
  return out;
}

// calendars: [{ name, parsed }] där parsed är resultatet från node-ical.
// Returnerar timmar per projekt och kalender för intervallet [from, to).
function buildReport(calendars, from, to) {
  const projects = new Map();
  const calendarTotals = Object.fromEntries(calendars.map((c) => [c.name, 0]));
  const events = [];

  for (const cal of calendars) {
    for (const inst of instancesInRange(cal.parsed, from, to)) {
      const hours = (inst.end - inst.start) / 3_600_000;
      const ids = projectsIn(inst.summary);
      const keys = ids.length ? ids : [NO_PROJECT];
      // En händelse med flera projektnummer delas lika mellan dem.
      const share = hours / keys.length;
      for (const id of keys) {
        if (!projects.has(id)) projects.set(id, { id, total: 0, byCalendar: {} });
        const p = projects.get(id);
        p.total += share;
        p.byCalendar[cal.name] = (p.byCalendar[cal.name] || 0) + share;
        events.push({
          calendar: cal.name,
          project: id,
          summary: inst.summary,
          start: inst.start.toISOString(),
          end: inst.end.toISOString(),
          hours: share,
        });
      }
      calendarTotals[cal.name] += hours;
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    calendars: calendars.map((c) => c.name),
    calendarTotals,
    projects: [...projects.values()].sort((a, b) => b.total - a.total),
    events,
    noProjectKey: NO_PROJECT,
  };
}

module.exports = { buildReport, projectsIn, NO_PROJECT };
