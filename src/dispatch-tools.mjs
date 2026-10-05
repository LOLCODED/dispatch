import { httpTool } from './http-tool.mjs';
import { sqlTool } from './sql-tool.mjs';
import { serviceTool } from './services.mjs';
import { ciTool } from './ci-tool.mjs';
export const questionTool = {
  name: 'dispatch_question', kind: 'question', description: 'Ask the operator 1–3 questions when a requirement or decision is unclear. Offer two or three concrete options with brief descriptions; dispatch adds an Other answer. Waits for the answer and returns it.',
  inputSchema: { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', properties: { id: { type: 'string' }, header: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', maxItems: 4, items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'], additionalProperties: false } } }, required: ['question'], additionalProperties: false } } }, required: ['questions'], additionalProperties: false },
};

export const memoryTool = {
  name: 'dispatch_memory', kind: 'memory', description: 'Repository memory kept by dispatch. list: the enabled rules and notes for this repository. remember: keep one short note (≤200 characters) for future tasks, including a lasting rule the operator states. forget: remove notes matching the text. Operator rules and preferences cannot be changed here.',
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'remember', 'forget'] }, text: { type: 'string', maxLength: 200 }, section: { type: 'string', enum: ['Gotchas', 'Conventions'] } }, required: ['action'], additionalProperties: false },
};

export const riskTool = {
  name: 'dispatch_risk', kind: 'risk', description: 'Inspect the current changed revision and available checks, then submit a risk-based testing plan. Include reasons for selecting and skipping checks. Uncertainty, manual review or always-ask mode waits for the operator. Only configured check IDs can execute. Browser observations are self-reported, not automated passes.',
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['inspect', 'submit'] }, revision: { type: 'string' },
    likelihood: { type: 'string', enum: ['low', 'medium', 'high'] }, impact: { type: 'string', enum: ['low', 'medium', 'high'] },
    confidence: { type: 'string', enum: ['confident', 'uncertain'] }, checks: { type: 'array', maxItems: 12, items: { type: 'string' } },
    reason: { type: 'string', maxLength: 2000 }, workflows: { type: 'string', maxLength: 2000 },
    observations: { type: 'string', maxLength: 2000 }, manualReview: { type: 'string', maxLength: 2000, description: 'Request the operator to perform and confirm these review steps before validation.' },
  }, required: ['action'], additionalProperties: false },
};

export const repositoryTool = {
  name: 'dispatch_repository', kind: 'repository', description: 'Add a folder outside this task to it instead of editing it in place. inspect: whether it is saved and the settings dispatch would give it. add: a saved repository joins without asking; a new folder is saved as a dispatch repository once the operator approves; either joins this task from the next turn with its own workspace and checks. Omitted settings use the inspect defaults; alwaysLink also links it to this repository for future tasks.',
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['inspect', 'add'] }, path: { type: 'string', maxLength: 1000 }, name: { type: 'string', maxLength: 100 }, baseBranch: { type: 'string', maxLength: 200 },
    checks: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 500 }, description: 'Check commands, e.g. npm run test' }, setup: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 500 } },
    textOnlyPaths: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } }, instructions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } },
    browser: { type: 'boolean' }, review: { type: 'boolean' }, alwaysLink: { type: 'boolean' },
  }, required: ['action', 'path'], additionalProperties: false },
};

export const permissionTool = {
  name: 'dispatch_permission', kind: 'permission', description: 'Used by Claude Code itself to ask dispatch about a tool request that needs approval. Do not call it directly; just use the tool you need.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'], additionalProperties: false },
};

const ref = { type: 'string', pattern: '^(?:f\\d{1,5})?e\\d{1,5}$', description: 'Element ref from the last snapshot' };
const browser = (name, description, properties = {}, required = []) => ({ name: `dispatch_browser_${name}`, kind: 'browser', description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const browserTools = [
  browser('navigate', 'Open a URL in the dispatch browser. Use app:/path for this worktree’s own app; dispatch starts its dev script. Returns the page snapshot.', { url: { type: 'string', maxLength: 2000 } }, ['url']),
  browser('snapshot', 'Accessibility snapshot of the current page with element refs (eN) to act on.'),
  browser('click', 'Click an element by ref.', { ref }, ['ref']),
  browser('hover', 'Hover an element by ref.', { ref }, ['ref']),
  browser('resize', 'Set viewport size in CSS pixels.', { width: { type: 'integer', minimum: 320, maximum: 2560 }, height: { type: 'integer', minimum: 240, maximum: 1600 } }, ['width', 'height']),
  browser('type', 'Type into an element by ref; submit presses Enter afterwards.', { ref, text: { type: 'string', maxLength: 4000 }, submit: { type: 'boolean' } }, ['ref', 'text']),
  browser('press', 'Press a keyboard key, e.g. Enter, Escape, Tab, Control+a.', { key: { type: 'string', pattern: '^[A-Za-z0-9+]{1,32}$' } }, ['key']),
  browser('select', 'Choose options in a select element by ref.', { ref, values: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } } }, ['ref', 'values']),
  browser('scroll', 'Scroll the page or an element.', { ref, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', minimum: 1, maximum: 5000 } }),
  browser('wait', 'Wait for text or a ref to appear, or a number of milliseconds (≤30000).', { text: { type: 'string', maxLength: 500 }, ref, ms: { type: 'integer', minimum: 1, maximum: 30000 } }),
  browser('back', 'Go back one page.'),
  browser('screenshot', 'JPEG screenshot of the viewport (or full page). Costs image tokens; prefer snapshot.', { fullPage: { type: 'boolean' } }),
  browser('console', 'Recent console messages and page errors.', { clear: { type: 'boolean' } }),
];

export const browserReviewTool = {
  name: 'dispatch_browser_review', kind: 'browser-review', description: 'Pause for operator UI feedback. First inspect screenshots and compare with the surrounding site. Include 1–4 screenshot IDs returned by screenshot, captions, your assessment and hands-on test steps. appPath opens the running worktree app. Also use it instead of dispatch_question for a choice between UI designs: build every variant, include one screenshot each and pass options, one per variant, instead of a yes/no verdict. Waits for feedback; does not pass checks.',
  inputSchema: { type: 'object', properties: {
    assessment: { type: 'string', maxLength: 2000, description: 'Visual fit, interaction checks and remaining concerns.' },
    steps: { type: 'string', maxLength: 1000, description: 'What the operator should try.' },
    screenshots: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: { id: { type: 'string' }, caption: { type: 'string', maxLength: 200 } }, required: ['id', 'caption'], additionalProperties: false } },
    appPath: { type: 'string', maxLength: 1000, description: 'Local app path, e.g. /settings. Requires a running preview.' },
    options: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: { label: { type: 'string', maxLength: 80 }, description: { type: 'string', maxLength: 200 } }, required: ['label'], additionalProperties: false } },
  }, required: ['assessment', 'steps', 'screenshots'], additionalProperties: false },
};

export const dispatchTools = Object.fromEntries([questionTool, memoryTool, riskTool, repositoryTool, permissionTool, browserReviewTool, ...browserTools, httpTool, sqlTool, serviceTool, ciTool].map(tool => [tool.name, tool]));
export const bridgeTools = [questionTool, memoryTool];

export function toolSet({ question = false, memory = false, browser = false, review = false, risk = false, repository = false, permission = false, http = false, sql = false, service = false, ci = false } = {}) {
  return [...(question ? [questionTool] : []), ...(memory ? [memoryTool] : []), ...(browser ? browserTools : []), ...(browser && review ? [browserReviewTool] : []), ...(http ? [httpTool] : []), ...(sql ? [sqlTool] : []), ...(service ? [serviceTool] : []), ...(ci ? [ciTool] : []), ...(risk ? [riskTool] : []), ...(repository ? [repositoryTool] : []), ...(permission ? [permissionTool] : [])];
}
export const toolNames = tools => tools.map(tool => tool.name);
export const toolSchemaCharacters = tools => JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).length;
export const toolsByName = names => names.map(name => dispatchTools[name]).filter(Boolean);

export function bridgeQuestions(questions) {
  if (!Array.isArray(questions)) return questions;
  return questions.map((question, index) => ({
    id: typeof question?.id === 'string' && /^[\w-]{1,64}$/.test(question.id) ? question.id : `question-${index + 1}`,
    header: typeof question?.header === 'string' ? question.header.slice(0, 120) : undefined,
    question: question?.question,
    options: Array.isArray(question?.options) ? question.options.filter(option => typeof option?.label === 'string').map(option => ({ label: option.label.slice(0, 200), description: typeof option.description === 'string' ? option.description.slice(0, 500) : '' })) : [],
  }));
}
