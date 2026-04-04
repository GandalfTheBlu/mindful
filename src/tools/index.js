import { webFetch } from './webFetch.js';
import { readFile } from './readFile.js';

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch the text content of a web page by URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read and summarise a local file by path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file.' },
          task: { type: 'string', description: 'What to look for or understand from the file.' }
        },
        required: ['path', 'task']
      }
    }
  }
];

export async function callTool(name, args) {
  if (name === 'web_fetch') return String(await webFetch(args));
  if (name === 'read_file') return String(await readFile(args));
  throw new Error(`Unknown tool: ${name}`);
}
