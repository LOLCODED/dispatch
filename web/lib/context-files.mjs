import { contextFileProblem, contextFileTypes } from '../../src/context-files.mjs';
export { contextFileProblem };
export const contextFileAccept = Object.keys(contextFileTypes).join(',');
let nextId = 0;
export function readContextFiles(files) {
  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: ++nextId, name: file.name, size: file.size, data: reader.result.slice(reader.result.indexOf(',') + 1) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));
}
export const contextFilePayload = files => files.map(({ name, data }) => ({ name, data }));
