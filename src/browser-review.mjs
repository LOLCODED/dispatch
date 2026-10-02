import { InputError } from './engine.mjs';

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const verdictOptions = [
  { label: 'Looks good (Recommended)', description: 'Continue with automated checks.' },
  { label: 'Needs changes', description: 'Describe what to change in a written answer, or attach screenshots.' },
];

function choiceOptions(options) {
  if (options === undefined) return null;
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) throw new InputError('Offer 2–4 options, one per alternative.');
  const labels = new Set();
  return options.map(option => {
    const label = option?.label?.trim();
    if (!text(option?.label, 80) || labels.has(label) || (option.description !== undefined && typeof option.description !== 'string') || option.description?.length > 200) throw new InputError('Each option needs a unique label (≤80 characters) and an optional description (≤200).');
    labels.add(label); return { label, description: option.description?.trim() ?? '' };
  });
}

export function browserReview(run, args) {
  if (!text(args.assessment, 2000) || !text(args.steps, 1000)) throw new InputError('Include a visual assessment and hands-on test steps.');
  if (!Array.isArray(args.screenshots) || !args.screenshots.length || args.screenshots.length > 4) throw new InputError('Choose 1–4 screenshots from this attempt.');
  const seen = new Set();
  const screenshots = args.screenshots.map(item => {
    const artifact = run.artifacts?.find(artifact => artifact.id === item?.id);
    if (!artifact || !['browser', 'agent'].includes(artifact.source) || !artifact.mimeType?.startsWith('image/') || artifact.attempt !== run.attempt || seen.has(item.id) || !text(item.caption, 200)) throw new InputError('Each screenshot needs a unique image ID from this attempt and a caption.');
    seen.add(item.id); return { id: item.id, caption: item.caption.trim() };
  });
  let appUrl;
  if (args.appPath !== undefined) {
    if (!text(args.appPath, 1000) || !/^\/(?!\/)/.test(args.appPath) || /[\\\s]/.test(args.appPath)) throw new InputError('Use a local app path such as /settings.');
    if (!run.devServer?.url || run.devServer.stoppedAt) throw new InputError('Open app:/ in the dispatch browser before requesting a live preview.');
    const url = new URL(args.appPath, run.devServer.url);
    if (url.origin !== new URL(run.devServer.url).origin) throw new InputError('Live preview must stay within the worktree app.');
    appUrl = url.href;
  }
  const choices = choiceOptions(args.options);
  return {
    kind: 'question', source: 'browser-review',
    review: { assessment: args.assessment.trim(), steps: args.steps.trim(), screenshots, ...(appUrl && { appUrl }) },
    questions: [{ id: 'browser-feedback', header: 'UI review', question: choices
      ? 'Which version should the agent continue with? Try the live app if available, or write what to change.'
      : 'How does this look and behave? Try the live app if available, then send your feedback.', options: choices ?? verdictOptions }],
  };
}
