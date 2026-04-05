import { complete } from '../llm.js';
import { searchMemories, listByTypeWithMeta } from '../core/vectraStore.js';
import config from '../config.js';

const GOAL_STALE_DAYS = 7;

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [recognize] ${label}`, data ?? '');
}

const RECURRENCE_SYSTEM = `/no_think
Given these related memory statements about the user, write one concise observation (under 20 words) describing the recurring theme or pattern. Start with "Pattern noticed:". Output only the observation, nothing else.`;

const EMOTIONAL_SYSTEM = `/no_think
Given these memory statements about the user, identify any recurring emotional theme (stress, anxiety, enthusiasm, uncertainty, confidence, etc.). If a clear recurring theme is present across multiple statements, write one sentence starting with "Emotional pattern:". If no clear recurring emotional theme, output NONE.`;

const CONTRADICTION_DETECT_SYSTEM = `/no_think
Review these numbered memory statements. Identify direct factual contradictions — where one statement makes the other factually impossible. Output only conflicting index pairs as "X vs Y", one per line. If none, output NONE.`;

const EMOTIONAL_KEYWORDS = [
  'stress', 'anxious', 'anxiety', 'worried', 'worry', 'overwhelm',
  'excited', 'enthusias', 'nervous', 'confident', 'uncertain',
  'struggle', 'frustrat', 'exhaust', 'passion', 'fear', 'dread'
];

export async function recognize(userId, injectedTexts, expandedQuery) {
  const recurrenceThreshold = config.patternRecognition?.recurrenceThreshold ?? 4;
  const recurrenceMinScore = config.patternRecognition?.recurrenceMinScore ?? 0.6;
  const observations = [];

  // Broader query to detect patterns — use searchMemories so we have scores.
  // Only count memories above the score threshold: low-scoring hits just mean
  // the store is sparse, not that the topic is genuinely recurring.
  const broadRaw = await searchMemories(userId, expandedQuery, 12);
  const broadCandidates = broadRaw.filter(m => m.score >= recurrenceMinScore);

  // --- Recurrence detection ---
  // If many relevant memories cluster around the same topic, the user keeps returning to it
  if (broadCandidates.length >= recurrenceThreshold) {
    const texts = broadCandidates.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
    const result = await complete(
      [
        { role: 'system', content: RECURRENCE_SYSTEM },
        { role: 'user', content: texts }
      ],
      { max_tokens: 60 }
    );
    const observation = result.trim();
    if (observation && !observation.toUpperCase().includes('NONE')) {
      log('recurrence', observation);
      observations.push(observation);
    }
  }

  // --- Emotional tone patterns ---
  // Only run if any emotional keywords appear in the score-filtered broad candidates
  if (broadCandidates.length > 0) {
    const combined = broadCandidates.map(m => m.text).join(' ').toLowerCase();
    const hasEmotional = EMOTIONAL_KEYWORDS.some(k => combined.includes(k));
    if (hasEmotional) {
      const texts = broadCandidates.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
      const result = await complete(
        [
          { role: 'system', content: EMOTIONAL_SYSTEM },
          { role: 'user', content: texts }
        ],
        { max_tokens: 60 }
      );
      const observation = result.trim();
      if (observation && !observation.toUpperCase().includes('NONE')) {
        log('emotional', observation);
        observations.push(observation);
      }
    }
  }

  // --- Contradiction surfacing ---
  // Check the injected memories (already filtered to be relevant) for contradictions
  if (injectedTexts.length >= 2) {
    const numbered = injectedTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const result = await complete(
      [
        { role: 'system', content: CONTRADICTION_DETECT_SYSTEM },
        { role: 'user', content: numbered }
      ],
      { max_tokens: 60 }
    );
    const response = result.trim();
    if (response && !response.toUpperCase().includes('NONE')) {
      const pairPattern = /(\d+)\s+vs\.?\s+(\d+)/gi;
      let match;
      while ((match = pairPattern.exec(response)) !== null) {
        const a = parseInt(match[1]) - 1;
        const b = parseInt(match[2]) - 1;
        if (a >= 0 && a < injectedTexts.length && b >= 0 && b < injectedTexts.length && a !== b) {
          const note = `Contradiction in retrieved memories: "${injectedTexts[a]}" vs "${injectedTexts[b]}"`;
          log('contradiction', note);
          observations.push(note);
        }
      }
    }
  }

  // --- Stale goal surfacing ---
  // Surface goals that haven't been retrieved recently, so they stay top of mind
  const goalItems = await listByTypeWithMeta(userId, 'goal');
  const staleGoals = goalItems
    .filter(g => {
      const ageDays = (Date.now() - g.lastAccessed) / (1000 * 60 * 60 * 24);
      return ageDays > GOAL_STALE_DAYS;
    })
    .slice(0, 2);
  for (const g of staleGoals) {
    log('stale-goal', g.text.slice(0, 80));
    observations.push(`Active goal (not recently discussed): ${g.text}`);
  }

  return observations;
}
