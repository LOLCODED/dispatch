import { crc32 } from 'node:zlib';

const dosTime = date => ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
const dosDate = date => (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
const maxBytes = 0xffffffff;

// Store-only ZIP (no compression, no ZIP64) so exports need nothing beyond Node built-ins.
export function zipEntries(entries, { date = new Date() } = {}) {
  const locals = [], central = [];
  let offset = 0, total = 0;
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/^\/+/, ''), 'utf8'), data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    total += data.length;
    if (data.length > maxBytes || total > maxBytes) throw new Error('Export exceeds the 4 GB ZIP limit.');
    const crc = crc32(data), local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime(date), 10); local.writeUInt16LE(dosDate(date), 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(0, 10);
    record.writeUInt16LE(dosTime(date), 12); record.writeUInt16LE(dosDate(date), 14); record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt16LE(0, 30); record.writeUInt16LE(0, 32); record.writeUInt16LE(0, 34); record.writeUInt16LE(0, 36); record.writeUInt32LE(0, 38); record.writeUInt32LE(offset, 42);
    locals.push(local, name, data); central.push(record, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

export function readZipDirectory(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Not a ZIP file.');
  const count = buffer.readUInt16LE(end + 10), start = buffer.readUInt32LE(end + 16), entries = [];
  let position = start;
  for (let index = 0; index < count; index++) {
    const nameLength = buffer.readUInt16LE(position + 28), extra = buffer.readUInt16LE(position + 30), comment = buffer.readUInt16LE(position + 32);
    entries.push({ name: buffer.toString('utf8', position + 46, position + 46 + nameLength), crc: buffer.readUInt32LE(position + 16), size: buffer.readUInt32LE(position + 24), offset: buffer.readUInt32LE(position + 42) });
    position += 46 + nameLength + extra + comment;
  }
  return entries;
}
