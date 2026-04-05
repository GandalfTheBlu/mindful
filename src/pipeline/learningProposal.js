import { stream, complete } from '../llm.js';
import { getUserModel } from '../core/userModel.js';
import { getRecentEntryTopics } from '../tools/learningStore.js';

function log(label, data) {
  console.log(`[${new Date().toISOString()}] [learningProposal] ${label}`, data ?? '');
}

// Extract a named section from the structured user model
function extractSection(model, name) {
  if (!model) return null;
  const match = model.match(new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##|\\s*$)`, 'i'));
  return match ? match[1].trim() : null;
}

const PROPOSAL_SYSTEM = `/no_think
You are opening a learning session for a user. Based on their current projects, goals, and interests — and accounting for topics they have already explored recently — propose exactly 3 specific learning topics worth exploring today.

For each topic:
- Give it a concise name (3–6 words)
- Write one sentence explaining why it is relevant to what the user is actively working on or aiming toward right now
- Be specific: not a broad domain but a concrete subtopic with clear practical value

Number the topics 1–3. After the list, invite the user to pick one, go deeper on a specific angle, or suggest something different entirely. Keep the tone conversational and direct — this is an offer, not a report.`;

export async function runLearningProposal(session, onChunk, onStatus = () => {}) {
  const { userId } = session;

  onStatus('Learning: Preparing topics...');

  const userModel = getUserModel(userId);
  const currentProjects = extractSection(userModel, 'Current Projects');
  const goals = extractSection(userModel, 'Goals');
  const interests = extractSection(userModel, 'Interests');
  const recentTopics = getRecentEntryTopics(userId, 5);

  const contextParts = [];
  if (currentProjects) contextParts.push(`Current Projects:\n${currentProjects}`);
  if (goals) contextParts.push(`Goals:\n${goals}`);
  if (interests) contextParts.push(`Interests:\n${interests}`);
  if (recentTopics.length > 0) {
    contextParts.push(`Recently explored (avoid repeating):\n${recentTopics.map(t => `- ${t}`).join('\n')}`);
  }

  if (contextParts.length === 0) {
    // No user model yet — fall back to a simple invitation
    const fallback = "I don't have enough information about you yet to suggest specific topics. What would you like to explore today? I can research any topic in depth and save findings for you.";
    onChunk(fallback);
    onStatus('Learning: ✓');
    return fallback;
  }

  log('context', `projects=${!!currentProjects} goals=${!!goals} interests=${!!interests} recent=${recentTopics.length}`);

  const today = new Date().toISOString().slice(0, 10);
  const userContent = `Today: ${today}\n\n${contextParts.join('\n\n')}`;

  let content = '';
  await stream(
    [
      { role: 'system', content: PROPOSAL_SYSTEM },
      { role: 'user', content: userContent }
    ],
    chunk => { content += chunk; onChunk(chunk); },
    { max_tokens: 300 }
  );

  content = content.trim();
  log('done', content.slice(0, 100));
  onStatus('Learning: ✓');
  return content || null;
}
