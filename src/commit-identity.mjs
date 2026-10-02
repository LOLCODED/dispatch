import { git } from './local-tools.mjs';

const dispatchIdentity = { name: 'dispatch', email: 'dispatch@lolcoded.dev' };
const coAuthorTrailer = `Co-Authored-By: ${dispatchIdentity.name} <${dispatchIdentity.email}>`;
const trailerLine = /^[\w-]+: \S/;

const identityConfig = ({ name, email }) => ['-c', `user.name=${name}`, '-c', `user.email=${email}`];
export const dispatchIdentityConfig = identityConfig(dispatchIdentity);

export const dispatchCoAuthor = project => project?.dispatchCoAuthor !== false;

async function userIdentity(cwd, signal) {
  const read = key => git(cwd, ['config', '--get', key], { signal }).catch(() => '');
  const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
  return name && email ? { name, email } : null;
}

export async function commitIdentity(cwd, { signal } = {}) {
  return await userIdentity(cwd, signal) ? [] : dispatchIdentityConfig;
}

// Git only reads trailers from the final paragraph, so the trailer joins an existing trailer block such as "Refs:".
export function coAuthored(message, project) {
  const text = message.trimEnd();
  if (!dispatchCoAuthor(project) || text.includes(coAuthorTrailer)) return text;
  const paragraphs = text.split(/\n\s*\n/);
  const joinsTrailers = paragraphs.length > 1 && paragraphs.at(-1).split('\n').every(line => trailerLine.test(line));
  return `${text}${joinsTrailers ? '\n' : '\n\n'}${coAuthorTrailer}`;
}
