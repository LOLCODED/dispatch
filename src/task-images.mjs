import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { InputError } from './engine.mjs';
import { decodeContextImages } from './browser-evidence.mjs';
import { contextImageLimits } from './context-images.mjs';

const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg' };

export function decodeTaskImages(images) {
  if (images === undefined) return [];
  const decoded = decodeContextImages(images);
  if (!decoded) throw new InputError(`Attach up to ${contextImageLimits.count} PNG or JPEG images of at most ${contextImageLimits.bytes / 1e6} MB each.`);
  return decoded.map(image => ({ ...image, sha256: createHash('sha256').update(image.bytes).digest('hex') }));
}

// Image bytes stay out of state.json; a task record only lists its files until its run copies them in.
export class TaskImages {
  constructor(dataDir) { this.root = join(resolve(dataDir), 'task-images'); }
  directory(taskId) { return join(this.root, taskId); }
  write(taskId, decoded) {
    if (!decoded.length) return [];
    mkdirSync(this.directory(taskId), { recursive: true });
    return decoded.map(({ extension, bytes, sha256 }, index) => {
      const file = `${index + 1}${extension}`;
      writeFileSync(join(this.directory(taskId), file), bytes, { flag: 'wx', mode: 0o600 });
      return { file, mimeType: mimeTypes[extension], size: bytes.length, sha256 };
    });
  }
  payload(task) {
    if (!task.images?.length) return {};
    return { images: task.images.map(image => ({ mimeType: image.mimeType, data: readFileSync(join(this.directory(task.id), image.file)).toString('base64') })) };
  }
  read(task, number) {
    const image = task.images?.[number - 1];
    if (!image) return null;
    try { return { mimeType: image.mimeType, bytes: readFileSync(join(this.directory(task.id), image.file)) }; } catch { return null; }
  }
  remove(taskId) { rmSync(this.directory(taskId), { recursive: true, force: true }); }
}
