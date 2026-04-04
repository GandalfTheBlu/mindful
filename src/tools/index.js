import { webFetch } from './webFetch.js';
import { webSearch } from './webSearch.js';
import { readFile } from './readFile.js';
import { listDirectory, writeFile, createDirectory } from './fileSystem.js';

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return a list of relevant results (titles, URLs, snippets). Use web_fetch to retrieve the full content of any result.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch the text content of a web page by URL. For long pages, provide a task to focus the summary.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch.' },
          task: { type: 'string', description: 'Optional: what to look for on the page.' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Optional: keywords to filter pages sections by before summarising. Only sections containing at least one keyword will be processed.' }
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
          task: { type: 'string', description: 'What to look for or understand from the file.' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Optional: keywords to filter file sections by before summarising. Only sections containing at least one keyword will be processed.' }
        },
        required: ['path', 'task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List the contents of a directory in the allowed workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the directory to list.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write text content to a file in the allowed workspace. Creates parent directories if needed. Overwrites existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file to write.' },
          content: { type: 'string', description: 'Text content to write.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory (and any missing parent directories) in the allowed workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the directory to create.' }
        },
        required: ['path']
      }
    }
  }
];

export async function callTool(name, args) {
  if (name === 'web_search') return String(await webSearch(args));
  if (name === 'web_fetch') return String(await webFetch(args));
  if (name === 'read_file') return String(await readFile(args));
  if (name === 'list_directory') return String(await listDirectory(args));
  if (name === 'write_file') return String(await writeFile(args));
  if (name === 'create_directory') return String(await createDirectory(args));
  throw new Error(`Unknown tool: ${name}`);
}
