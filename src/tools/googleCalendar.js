import { google } from 'googleapis';
import { getAuthClient } from '../core/googleAuth.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [tool:calendar] ${label}`, data ?? '');
}

export async function getCalendarEvents({ days = 7, maxResults = 20 }) {
  const auth = getAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  log('query', `next ${days} days, max ${maxResults} events`);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = res.data.items ?? [];
  log('results', `${events.length} events`);

  if (events.length === 0) return 'No upcoming events found.';

  return events.map(e => {
    const start = e.start.dateTime ?? e.start.date;
    const end = e.end.dateTime ?? e.end.date;
    const loc = e.location ? ` @ ${e.location}` : '';
    return `${start} – ${end}: ${e.summary ?? '(no title)'}${loc}`;
  }).join('\n');
}
