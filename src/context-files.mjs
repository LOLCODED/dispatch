export const contextFileLimits = { count: 4, bytes: 5000000 };
export const contextFileTypes = {
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.md': 'text/markdown', '.tsv': 'text/tab-separated-values', '.rtf': 'application/rtf', '.json': 'application/json'
};
export const contextFileExtension = name => typeof name === 'string' ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
export const contextFileProblem = (files, attached = 0) => {
  if (attached + files.length > contextFileLimits.count) return `Attach up to ${contextFileLimits.count} documents.`;
  if (files.some(file => typeof file.name !== 'string' || file.name.length > 180 || /[/\\\x00-\x1f\x7f]/.test(file.name) || !Object.hasOwn(contextFileTypes, contextFileExtension(file.name)))) return 'Choose PDF, Office, CSV, TSV, text, Markdown, RTF or JSON files.';
  if (files.some(file => !file.size || file.size > contextFileLimits.bytes)) return 'Each document must be nonempty and at most 5 MB.';
  return null;
};

export function decodeContextFiles(files) {
  if (!Array.isArray(files) || files.length > contextFileLimits.count) return null;
  const decoded = files.map(file => {
    if (!file || typeof file.data !== 'string' || file.data.length > Math.ceil(contextFileLimits.bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) return null;
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data || contextFileProblem([{ name: file.name, size: bytes.length }])) return null;
    const extension = contextFileExtension(file.name);
    return { name: file.name, extension, mimeType: contextFileTypes[extension], bytes };
  });
  return decoded.every(Boolean) ? decoded : null;
}
