import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { readZipDirectory, zipEntries } from '../src/zip.mjs';

test('store-only zip writes readable local and central records with correct CRCs and offsets', () => {
  const entries = [{ name: 'run.json', data: '{"ok":true}' }, { name: 'artifacts/a.png', data: Buffer.from([137, 80, 78, 71]) }, { name: 'empty.txt', data: '' }];
  const zip = zipEntries(entries, { date: new Date(2026, 8, 30, 12, 0, 0) });
  const directory = readZipDirectory(zip);
  assert.deepEqual(directory.map(entry => entry.name), ['run.json', 'artifacts/a.png', 'empty.txt']);
  for (const [index, entry] of directory.entries()) {
    const data = Buffer.isBuffer(entries[index].data) ? entries[index].data : Buffer.from(entries[index].data);
    assert.equal(entry.size, data.length); assert.equal(entry.crc, crc32(data));
    assert.equal(zip.readUInt32LE(entry.offset), 0x04034b50);
    const nameLength = zip.readUInt16LE(entry.offset + 26);
    assert.equal(zip.subarray(entry.offset + 30 + nameLength, entry.offset + 30 + nameLength + data.length).equals(data), true);
  }
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
