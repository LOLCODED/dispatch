import { runProcess as defaultRunProcess } from '../process.mjs';
import { git, localEnvironment, plainText } from '../local-tools.mjs';
import { contractVersion } from './contract.mjs';
import { describeChange } from '../change-summary.mjs';
import { withView } from '../views.mjs';
import { parseDelimited } from '../database.mjs';
import { tableChanges } from '../table-changes.mjs';

export function connectorApi({ runProcess = defaultRunProcess } = {}) {
  return Object.freeze({
    contractVersion, runProcess, localEnvironment, plainText, describeChange, withView, parseDelimited, tableChanges,
    git: (cwd, args, options = {}) => git(cwd, args, options, runProcess),
  });
}
