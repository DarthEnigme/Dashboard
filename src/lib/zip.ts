// Minimal ZIP writer (stored, no compression): small bundles in memory (zip), large ones straight to disk (zipToFile).
import fs from "node:fs";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** `seed` continues a checksum over the next chunk (pass the previous result). */
export function crc32(buf: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time fields for the local and central headers. */
function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zip(files: { name: string; data: string | Uint8Array }[], at = new Date()): Buffer {
  const { time, date } = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : Buffer.from(f.data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const CHUNK = 1024 * 1024;

/** Read a file in chunks: its size and checksum first, its bytes when it is written. */
function eachChunk(file: string, fn: (chunk: Buffer) => void) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(CHUNK);
  try {
    for (let n = fs.readSync(fd, buf, 0, CHUNK, null); n > 0; n = fs.readSync(fd, buf, 0, CHUNK, null)) fn(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Write a zip to `out` one entry at a time, so a large file (the database in a backup) is never
 * held in memory: entries name either `data` or a `file` to copy in.
 */
export function zipToFile(out: string, entries: ({ name: string } & ({ data: string | Uint8Array } | { file: string }))[], at = new Date()) {
  const { time, date } = dosTime(at);
  const centrals: Buffer[] = [];
  let offset = 0;
  const fd = fs.openSync(out, "w");
  const write = (b: Uint8Array) => {
    fs.writeSync(fd, b);
    offset += b.length;
  };
  try {
    for (const e of entries) {
      const name = Buffer.from(e.name, "utf8");
      const data = "data" in e ? (typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data)) : undefined;
      let crc = 0;
      let size = 0;
      if (data) {
        crc = crc32(data);
        size = data.length;
      } else {
        eachChunk((e as { file: string }).file, (c) => {
          crc = crc32(c, crc);
          size += c.length;
        });
      }
      if (size > 0xffffffff || offset > 0xffffffff) throw new Error(`${e.name} is too large for a zip (4 GB)`);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(date, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(size, 20);
      central.writeUInt32LE(size, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, name);

      write(local);
      write(name);
      if (data) write(data);
      else eachChunk((e as { file: string }).file, write);
    }
    const dirOffset = offset;
    const dir = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(dirOffset, 16);
    fs.writeSync(fd, dir);
    fs.writeSync(fd, end);
  } finally {
    fs.closeSync(fd);
  }
}
