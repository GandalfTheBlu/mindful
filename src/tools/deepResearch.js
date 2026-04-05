import { webResearch } from './webResearch.js';
import config from '../config.js';

// Wraps webResearch as an LLM-callable tool with higher iteration budget.
export async function deepResearch(args, onStatus = () => {}) {
  const { topic, goal } = args;
  if (!topic?.trim() || !goal?.trim()) throw new Error('topic and goal are required');

  // Override maxIterations for deep research — more thorough than standard web_research
  const savedMax = config.tools?.webResearch?.maxIterations;
  if (config.tools?.webResearch) {
    config.tools.webResearch.maxIterations = config.tools?.learning?.deepResearchIterations ?? 10;
  }

  try {
    return await webResearch({ topic, goal }, onStatus);
  } finally {
    if (config.tools?.webResearch && savedMax !== undefined) {
      config.tools.webResearch.maxIterations = savedMax;
    }
  }
}
