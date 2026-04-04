import { stream } from '../llm.js';
import { listByType } from '../core/vectraStore.js';
import { getUserModel } from '../core/userModel.js';
import { getCalendarEvents } from '../tools/googleCalendar.js';
import { searchMail } from '../tools/googleMail.js';
import { listTasks } from '../tools/googleTasks.js';
import { getWeather } from '../tools/weather.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [briefing] ${label}`, data ?? '');
}

const BRIEFING_SYSTEM = `/no_think
You are generating a daily briefing for a user. Using the provided context, write a focused briefing (4–8 sentences). Guidelines:

- Highlight calendar events worth noting, especially those connected to goals or tasks.
- Surface tasks that are overdue or due soon; skip the routine ones unless they connect to something else.
- Surface emails that are genuinely important or actionable; skip promotions and newsletters.
- Note the weather only when it's relevant to something in the schedule or goals (e.g. an outdoor event, a commute).
- Note meaningful connections across sources (event + related task + weather, goal + overdue task, etc.).
- Be direct and specific. Skip anything routine or irrelevant.`;

export async function runBriefing(session, onChunk) {
  const { userId } = session;
  const googleConfigured = !!config.google?.tokenFile;
  const weatherConfigured = config.tools?.weather?.lat != null && config.tools?.weather?.lon != null;

  log('start', `userId=${userId}, google=${googleConfigured}, weather=${weatherConfigured}`);

  const [calendarText, mailText, tasksText, weatherText, goals, userModel] = await Promise.all([
    googleConfigured
      ? getCalendarEvents({ days: 7, maxResults: 20 }).catch(err => `(unavailable: ${err.message})`)
      : Promise.resolve(null),
    googleConfigured
      ? searchMail({ query: 'is:important newer_than:7d', maxResults: 10 }).catch(err => `(unavailable: ${err.message})`)
      : Promise.resolve(null),
    googleConfigured
      ? listTasks({ maxResults: 30 }).catch(err => `(unavailable: ${err.message})`)
      : Promise.resolve(null),
    weatherConfigured
      ? getWeather({ days: 7 }).catch(err => `(unavailable: ${err.message})`)
      : Promise.resolve(null),
    listByType(userId, 'goal'),
    Promise.resolve(getUserModel(userId))
  ]);

  const sections = [];
  if (weatherText) sections.push(`Weather (next 7 days):\n${weatherText}`);
  if (calendarText) sections.push(`Calendar (next 7 days):\n${calendarText}`);
  if (tasksText) sections.push(`Pending tasks:\n${tasksText}`);
  if (mailText) sections.push(`Recent important mail:\n${mailText}`);
  if (goals.length > 0) sections.push(`Active goals:\n${goals.map(g => `- ${g}`).join('\n')}`);
  if (userModel) sections.push(`About the user:\n${userModel}`);

  const contextContent = sections.join('\n\n');
  log('context', `sections=${sections.length}, goals=${goals.length}, userModel=${!!userModel}`);

  let content = '';
  await stream(
    [
      { role: 'system', content: BRIEFING_SYSTEM },
      { role: 'user', content: contextContent }
    ],
    chunk => { content += chunk; onChunk(chunk); },
    { max_tokens: 400 }
  );

  content = content.trim();
  log('done', content.slice(0, 100));
  return content || null;
}
