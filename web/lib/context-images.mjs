import { contextImageLimits } from '../../src/context-images.mjs';

export { contextImageLimits };

let nextId = 0;

const readDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export const pastedImageFiles = clipboard => [...(clipboard?.files ?? [])].filter(file => file.type.startsWith('image/'));

export function contextImageProblem(files, attached = 0) {
  const { count, bytes, types } = contextImageLimits;
  if (attached + files.length > count) return `Attach up to ${count} images.`;
  if (files.some(file => !types.includes(file.type))) return 'Paste PNG or JPEG images.';
  if (files.some(file => file.size > bytes)) return `Each image must be at most ${bytes / 1e6} MB.`;
  return null;
}

export function readContextImages(files) {
  return Promise.all(files.map(async file => {
    const url = await readDataUrl(file);
    return { id: ++nextId, mimeType: file.type, data: url.slice(url.indexOf(',') + 1), url };
  }));
}

export const contextImagePayload = images => images.map(({ mimeType, data }) => ({ mimeType, data }));
