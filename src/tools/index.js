import { webFetch } from './webFetch.js';
import { webSearch } from './webSearch.js';
import { readFile } from './readFile.js';
import { listDirectory, writeFile, createDirectory } from './fileSystem.js';
import { getCalendarEvents } from './googleCalendar.js';
import { searchMail } from './googleMail.js';

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return a list of results (titles, URLs, snippets). If the answer is not directly present in the snippets, follow up with web_fetch on the most relevant URL to get the full content.',
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
          keywords: { type: 'array', items: { type: 'string' }, description: 'Optional: keywords to filter page sections before summarising. Only sections containing at least one keyword will be processed.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read and summarise a local file. Required before overwriting a file with write_file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file.' },
          task: { type: 'string', description: 'What to look for or understand from the file.' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Optional: keywords to filter file sections before summarising. Only sections containing at least one keyword will be processed.' }
        },
        required: ['path', 'task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List the contents of a directory in the workspace. Must be called on the parent directory before using write_file or create_directory inside it.',
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
      description: 'Write text content to a file in the workspace. Two preconditions must be met: (1) the parent directory must have been listed with list_directory in this same turn; (2) if the file already exists, it must have been read with read_file in this same turn.',
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
      description: 'Create a new directory in the workspace. The parent directory must have been listed with list_directory in this same turn. Fails if the directory already exists.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the directory to create.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_events',
      description: "Fetch upcoming events from the user's Google Calendar.",
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'How many days ahead to look (default 7).' },
          maxResults: { type: 'number', description: 'Maximum number of events to return (default 20).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_mail',
      description: "Search the user's Gmail using Gmail search syntax (e.g. 'from:someone@example.com', 'subject:invoice', 'is:unread'). Returns subject, sender, date, and a short snippet per message.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query.' },
          maxResults: { type: 'number', description: 'Maximum number of messages to return (default 10).' },
          includeBody: { type: 'boolean', description: 'If true, include the full plain-text body. Default false (snippet only).' }
        },
        required: ['query']
      }
    }
  }
];

export async function callTool(name, args, context = {}) {
  if (name === 'web_search') return String(await webSearch(args));
  if (name === 'web_fetch') return String(await webFetch(args));
  if (name === 'read_file') return String(await readFile(args, context));
  if (name === 'list_directory') return String(await listDirectory(args, context));
  if (name === 'write_file') return String(await writeFile(args, context));
  if (name === 'create_directory') return String(await createDirectory(args, context));
  if (name === 'get_calendar_events') return String(await getCalendarEvents(args));
  if (name === 'search_mail') return String(await searchMail(args));
  throw new Error(`Unknown tool: ${name}`);
}
