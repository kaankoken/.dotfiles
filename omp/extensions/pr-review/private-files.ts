export type SyncChunkWriter = (
  bytes: Uint8Array,
  offset: number,
  length: number,
) => number;

export function writeAllSync(bytes: Uint8Array, writeChunk: SyncChunkWriter): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset;
    const written = writeChunk(bytes, offset, remaining);
    if (!Number.isSafeInteger(written) || written < 0 || written > remaining) {
      throw new Error("private file write returned an invalid byte count");
    }
    if (written === 0) throw new Error("private file write made no progress");
    offset += written;
  }
}
