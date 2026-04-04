import { stream } from '../llm.js';
import { listByType } from '../core/vectraStore.js';
import { getUserModel } from '../core/userModel.js';
import { getCalendarEvents } from '../tools/googleCalendar.js';
import { searchMail } from '../tools/googleMail.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [briefing] ${label}`, data ?? '');
}

const BRIEFING_SYSTEM = `/no_think
You are generating a daily briefing for a user. Using the provided context — upcoming calendar events, recent emails, active goals, and background on the user — write a focused briefing (3–6 sentences). Highlight calendar events worth noting, especially those connected to goals or known context. Surface emails that seem genuinely important or actionable; skip obvious promotions and newsletters. Note meaningful connections between events, emails, and goals where they exist. Be direct and specific. Skip anything routine or irrelevant.`;

export async function runBriefing(session, onChunk) {
  const { userId } = session;
  const googleConfigured = !!config.google?.tokenFile;

  log('start', `userId=${userId}, google=${googleConfigured}`);

  const [calendarText, mailText, goals, userModel] = await Promise.all([
    googleConfigured
      ? getCalendarEvents({ days: 7, maxResults: 20 }).catch(err => `(unavailable: ${err.message})`)
      : Promise.resolve('(not configured)'),
    googleConfigured
      ? searchMail({ query: 'is:important newer_than:7d', maxResults: 10 }).catch(err => `(unavailable: ${err.message})`)
      : Promise.resolve('(not configured)'),
    listByType(userId, 'goal'),
    Promise.resolve(getUserModel(userId))
  ]);

  const sections = [
    `Calendar (next 7 days):\n${calendarText}`,
    `Recent important mail:\n${mailText}`
  ];
  if (goals.length > 0) sections.push(`Active goals:\n${goals.map(g => `- ${g}`).join('\n')}`);
  if (userModel) sections.push(`About the user:\n${userModel}`);

  const contextContent = sections.join('\n\n');
  log('context', `${goals.length} goals, userModel=${!!userModel}`);

  let content = '';
  await stream(
    [
      { role: 'system', content: BRIEFING_SYSTEM },
      { role: 'user', content: contextContent }
    ],
    chunk => { content += chunk; onChunk(chunk); },
    { max_tokens: 300 }
  );

  content = content.trim();
  log('done', content.slice(0, 100));
  return content || null;
}
