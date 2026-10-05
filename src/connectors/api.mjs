import { runProcess as defaultRunProcess } from '../process.mjs';
import { git, localEnvironment, plainText } from '../local-tools.mjs';
import { contractVersion } from './contract.mjs';
import { describeChange } from '../change-summary.mjs';
import { withView } from '../views.mjs';

export function connectorApi({ runProcess = defaultRunProcess } = {}) {
  return Object.freeze({
    contractVersion, runProcess, localEnvironment, plainText, describeChange, withView,
    git: (cwd, args, options = {}) => git(cwd, args, options, runProcess),
  });
}
