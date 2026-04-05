import { stream, complete } from '../llm.js';
import { listByType } from '../core/vectraStore.js';
import { getUserModel } from '../core/userModel.js';
import { getCalendarEvents } from '../tools/googleCalendar.js';
import { searchMail } from '../tools/googleMail.js';
import { listTasks } from '../tools/googleTasks.js';
import { getWeather } from '../tools/weather.js';
import { getTopArtists } from '../tools/spotify.js';
import { webResearch } from '../tools/webResearch.js';
import config from '../config.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [briefing] ${label}`, data ?? '');
}

// Extract artist names from getTopArtists() formatted output
function parseArtistNames(text) {
  const names = [];
  for (const m of text.matchAll(/^\d+\.\s+(.+?)(?:\s+\(|$)/gm)) {
    names.push(m[1].trim());
  }
  return names;
}

// Ask the LLM to derive 2–3 specific interest areas for seeding news searches.
// Returns a comma-separated string like "competitive fencing, audio engineering" or null.
async function deriveNewsInterests(goals, userModel) {
  const parts = [];
  if (goals.length > 0) parts.push(`Goals:\n${goals.map(g => `- ${g}`).join('\n')}`);
  if (userModel) parts.push(`User summary:\n${userModel}`);
  if (parts.length === 0) return null;

  const prompt = `/no_think
Based on the interests, goals, and background below, identify 2–3 specific topics this person would find most relevant in a daily news briefing. Focus on substantive interest areas (fields, communities, industries, issues) — not generic categories like "technology" or "sports". Output only a short comma-separated list. If no clear interests are present, output "none".

${parts.join('\n\n')}`;

  try {
    const raw = await complete([{ role: 'user', content: prompt }], { max_tokens: 40, temperature: 0 });
    const interests = raw.replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase();
    if (!interests || interests === 'none' || interests.length < 3) return null;
    log('news-interests', interests);
    return interests;
  } catch (err) {
    log('news-interests-error', err.message);
    return null;
  }
}

// Ask the LLM to derive a compact event search topic from goals and user model.
// Returns a short phrase like "photography workshop" or null if nothing relevant.
async function deriveEventTopic(goals, userModel) {
  const parts = [];
  if (goals.length > 0) parts.push(`Goals:\n${goals.map(g => `- ${g}`).join('\n')}`);
  if (userModel) parts.push(`User summary:\n${userModel}`);
  if (parts.length === 0) return null;

  const prompt = `/no_think
Based on the interests and goals below, identify a single specific topic suitable for searching upcoming events, workshops, or meetups. Output only a short search phrase (2–5 words). If no clearly searchable topic is present, output "none".

${parts.join('\n\n')}`;

  try {
    const raw = await complete([{ role: 'user', content: prompt }], { max_tokens: 20, temperature: 0 });
    const topic = raw.replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase();
    if (!topic || topic === 'none' || topic.length < 3) return null;
    log('event-topic', topic);
    return topic;
  } catch (err) {
    log('event-topic-error', err.message);
    return null;
  }
}

function buildWorldNewsGoal(today, interests) {
  const interestClause = interests
    ? ` Also look for stories relevant to: ${interests}.`
    : '';
  return `Find the most significant world news stories published today (${today}). For each story you include, you MUST confirm and state the exact publication date from the source — discard any story whose date cannot be verified. State exactly what happened: name the specific people, organisations, countries, and concrete outcomes. Do not use vague phrases.${interestClause} Cover 4–6 stories.`;
}

function buildLocalNewsGoal(city, country, today, interests) {
  const loc = country ? `${city}, ${country}` : city;
  const interestClause = interests ? ` Also look for stories relevant to: ${interests}.` : '';
  return `Find local news from ${loc} published today (${today}) or within the last 24 hours. For each story confirm and state the publication date — discard any story whose date cannot be verified from the source. State what specifically happened, naming the people, places, and decisions involved.${interestClause} Cover 3–4 stories.`;
}

function buildBriefingSystem(region) {
  return `/no_think
You are generating a daily briefing for a user. Using the provided context, write a focused briefing (6–10 sentences). Guidelines:

- For each news story, state the confirmed publication date (e.g. "April 5 —") before anything else. Omit any story whose date was not confirmed in the research — do not guess or infer dates from context. State what specifically happened: name the people, organisations, places, and concrete outcomes. Avoid vague phrases like "tensions rise" or "officials respond" — write the actual event.
- Highlight calendar events worth noting, especially those connected to goals or tasks.
- Surface tasks that are overdue or due soon; skip the routine ones unless they connect to something else.
- Surface emails that are genuinely important or actionable; skip promotions and newsletters.
- Note the weather only when it's relevant to something in the schedule or goals.
- Mention upcoming concerts or music events near the user or elsewhere in ${region} if they match the user's taste.
- Mention other relevant upcoming events, workshops, or meetups that match the user's goals or interests.
- Note meaningful connections across sources.
- Be direct and specific. Skip anything routine or irrelevant.`;
}

export async function runBriefing(session, onChunk, onStatus = () => {}) {
  const { userId } = session;
  const googleConfigured = !!config.google?.tokenFile;
  const weatherConfigured = config.tools?.weather?.lat != null && config.tools?.weather?.lon != null;
  const spotifyConfigured = !!config.spotify?.tokenFile;
  const city    = config.tools?.briefing?.city;
  const country = config.tools?.briefing?.country;
  const region  = config.tools?.briefing?.region ?? 'your region';
  const year    = new Date().getFullYear();

  log('start', `userId=${userId} google=${googleConfigured} weather=${weatherConfigured} spotify=${spotifyConfigured}`);

  // Convenience: create a prefixed onStatus forwarder for each research task
  const statusFor = prefix => label => onStatus(`${prefix}: ${label}`);

  const today = new Date().toISOString().slice(0, 10);

  // --- Pre-phase: fetch user profile (fast/local) to seed news searches ---
  const [goals, userModel] = await Promise.all([
    listByType(userId, 'goal'),
    Promise.resolve(getUserModel(userId))
  ]);
  const newsInterests = await deriveNewsInterests(goals, userModel);
  log('news-interests', newsInterests ?? '(none)');

  // --- Phase 1: fetch all context data and run news research in parallel ---
  onStatus('Data: Fetching...');
  const [calendarText, mailText, tasksText, weatherText, newsText, localNewsText, spotifyText] = await Promise.all([
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
    webResearch({
      topic: 'top world news today',
      goal: buildWorldNewsGoal(today, newsInterests)
    }, statusFor('World news')).catch(err => { log('news-error', err.message); return null; }),
    city
      ? webResearch({
          topic: `local news ${city} today`,
          goal: buildLocalNewsGoal(city, country, today, newsInterests)
        }, statusFor(`${city} news`)).catch(err => { log('local-news-error', err.message); return null; })
      : Promise.resolve(null),
    spotifyConfigured
      ? getTopArtists({ timeRange: 'short_term', limit: 10 }).catch(err => { log('spotify-error', err.message); return null; })
      : Promise.resolve(null),
  ]);

  onStatus('Data: ✓');

  // --- Phase 2: derive interest-based event topic from goals + user model ---
  const eventTopic = await deriveEventTopic(goals, userModel);

  // --- Phase 3: run all 4 event searches in parallel ---
  const artistNames = (spotifyText && !spotifyText.startsWith('(unavailable')) ? parseArtistNames(spotifyText) : [];
  const artistQuery = artistNames.slice(0, 5).join(' ');

  const [musicLocalText, musicEuropeText, eventsLocalText, eventsEuropeText] = await Promise.all([
    artistNames.length > 0 && city
      ? webResearch({
          topic: `upcoming concerts near ${city}`,
          goal: `Find upcoming live concerts and music events in or near ${city} featuring any of these artists or similar genres: ${artistQuery}. Include event name, date, venue, and a link if available.`
        }, statusFor(`Concerts near ${city}`)).catch(err => { log('music-local-error', err.message); return null; })
      : Promise.resolve(null),
    artistNames.length > 0
      ? webResearch({
          topic: `upcoming ${region} concert tour dates for ${artistNames.slice(0, 3).join(', ')}`,
          goal: `Find upcoming concert and tour dates across ${region} in ${year} for: ${artistQuery}. Include artist, city, venue, and date for each event.`
        }, statusFor(`Concerts ${region}`)).catch(err => { log('music-europe-error', err.message); return null; })
      : Promise.resolve(null),
    eventTopic && city
      ? webResearch({
          topic: `${eventTopic} events near ${city}`,
          goal: `Find upcoming events, workshops, meetups, or gatherings related to ${eventTopic} in or near ${city} in ${year}. Include name, date, and how to attend.`
        }, statusFor(`Events near ${city}`)).catch(err => { log('events-local-error', err.message); return null; })
      : Promise.resolve(null),
    eventTopic
      ? webResearch({
          topic: `${eventTopic} events in ${region} ${year}`,
          goal: `Find notable upcoming events, conferences, or gatherings related to ${eventTopic} anywhere in ${region} in ${year}. Include name, location, date.`
        }, statusFor(`Events ${region}`)).catch(err => { log('events-europe-error', err.message); return null; })
      : Promise.resolve(null),
  ]);

  log('searches', `music-local=${!!musicLocalText} music-europe=${!!musicEuropeText} events-local=${!!eventsLocalText} events-europe=${!!eventsEuropeText}`);

  // --- Assemble context sections ---
  const sections = [];
  if (newsText)        sections.push(`World news today:\n${newsText}`);
  if (localNewsText)   sections.push(`Local news (${city}) today:\n${localNewsText}`);
  if (weatherText)     sections.push(`Weather (next 7 days):\n${weatherText}`);
  if (calendarText)    sections.push(`Calendar (next 7 days):\n${calendarText}`);
  if (tasksText)       sections.push(`Pending tasks:\n${tasksText}`);
  if (mailText)        sections.push(`Recent important mail:\n${mailText}`);
  if (goals.length > 0) sections.push(`Active goals:\n${goals.map(g => `- ${g}`).join('\n')}`);
  if (spotifyText)     sections.push(`Music taste:\n${spotifyText}`);
  if (musicLocalText)  sections.push(`Upcoming concerts near ${city ?? 'home'}:\n${musicLocalText}`);
  if (musicEuropeText) sections.push(`Upcoming concerts in ${region}:\n${musicEuropeText}`);
  if (eventsLocalText) sections.push(`Upcoming events near ${city ?? 'home'} (${eventTopic}):\n${eventsLocalText}`);
  if (eventsEuropeText) sections.push(`Upcoming events in ${region} (${eventTopic}):\n${eventsEuropeText}`);
  if (userModel)       sections.push(`About the user:\n${userModel}`);

  log('context', `sections=${sections.length} goals=${goals.length} eventTopic=${eventTopic ?? 'none'}`);
  sections.forEach(s => {
    const header = s.split('\n')[0];
    const preview = s.slice(header.length + 1, header.length + 80).replace(/\n/g, ' ');
    log('section', `${header} → ${preview}`);
  });

  // --- Phase 4: synthesise ---
  onStatus('Briefing: Writing...');
  let content = '';
  await stream(
    [
      { role: 'system', content: buildBriefingSystem(region) },
      { role: 'user', content: sections.join('\n\n') }
    ],
    chunk => { content += chunk; onChunk(chunk); },
    { max_tokens: 600 }
  );

  content = content.trim();
  log('done', content.slice(0, 100));
  return content || null;
}
