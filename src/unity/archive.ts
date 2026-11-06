// Unity exports GUID/{pathname,asset,asset.meta} inside a gzip-compressed tar.
// Stream tar members into their own buffers: a large avatar never needs a second
// in-memory copy of its whole decompressed archive.
const MiB = 1024 * 1024;
export const ARCHIVE_LIMITS = {
  compressed: 512 * MiB, expanded: 768 * MiB, asset: 256 * MiB, metadata: 8 * MiB,
  pathname: 8 * 1024, entries: 65536,
} as const;

export interface ArchiveAsset { guid: string; path: string; meta: string; bytes: Uint8Array<ArrayBuffer> }
type Parts = { asset?: Uint8Array<ArrayBuffer>; pathname?: Uint8Array<ArrayBuffer>; 'asset.meta'?: Uint8Array<ArrayBuffer> };
const utf8 = new TextDecoder();

export async function readArchive(file: Blob): Promise<ArchiveAsset[]> {
  if (file.size > ARCHIVE_LIMITS.compressed) throw new Error('パッケージが大きすぎます（圧縮時の上限: 512 MiB）。');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (magic[0] !== 0x1f || magic[1] !== 0x8b) throw new Error('gzip 形式の .unitypackage を選んでください。');
  if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザは gzip 展開に対応していません。');
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const members = new Map<string, Parts>();
  const header = new Uint8Array(512);
  let headerPos = 0, total = 0, entries = 0, fileSize = 0, within = 0, paddedSize = 0;
  let dest: Uint8Array<ArrayBuffer> | undefined, ended = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > ARCHIVE_LIMITS.expanded) throw new Error('パッケージの展開サイズが 768 MiB を超えています。');
      let cursor = 0;
      while (cursor < value.length) {
        if (ended) {
          if (value.subarray(cursor).some(b => b !== 0)) throw new Error('tar の終端に不正なデータがあります。');
          break;
        }
        if (within < paddedSize) {
          const count = Math.min(value.length - cursor, paddedSize - within);
          if (dest && within < fileSize) dest.set(value.subarray(cursor, cursor + Math.min(count, fileSize - within)), within);
          within += count; cursor += count;
          continue;
        }
        const count = Math.min(value.length - cursor, 512 - headerPos);
        header.set(value.subarray(cursor, cursor + count), headerPos);
        headerPos += count; cursor += count;
        if (headerPos !== 512) continue;
        headerPos = 0;
        if (header.every(b => b === 0)) { ended = true; continue; }
        if (++entries > ARCHIVE_LIMITS.entries) throw new Error('tar のエントリー数が上限を超えています。');
        const field = (start: number, end: number) => utf8.decode(header.subarray(start, end)).split('\0', 1)[0].trim();
        const octal = (s: string) => /^[0-7]+$/.test(s) ? parseInt(s, 8) : NaN;
        const checksum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
        if (octal(field(148, 156)) !== checksum) throw new Error('tar ヘッダーのチェックサムが一致しません。');
        const name = field(0, 100).replace(/^(?:\.\/)+/, '');
        fileSize = octal(field(124, 136)); within = 0; dest = undefined;
        if (!Number.isSafeInteger(fileSize) || fileSize > ARCHIVE_LIMITS.asset) throw new Error('tar のファイルサイズが不正、または 256 MiB を超えています。');
        paddedSize = Math.ceil(fileSize / 512) * 512;
        const match = /^([0-9a-f]{32})\/(asset|asset\.meta|pathname)$/i.exec(name);
        if (!match || (header[156] !== 0 && header[156] !== 48)) continue;
        const guid = match[1].toLowerCase(), part = match[2] as keyof Parts;
        const parts = members.get(guid) ?? {};
        if (parts[part]) throw new Error('tar に重複する GUID エントリーがあります。');
        if ((part === 'asset.meta' && fileSize > ARCHIVE_LIMITS.metadata) || (part === 'pathname' && fileSize > ARCHIVE_LIMITS.pathname)) {
          throw new Error('Unity メタデータのサイズが上限を超えています。');
        }
        dest = new Uint8Array(fileSize);
        parts[part] = dest; members.set(guid, parts);
      }
    }
    if (!ended || headerPos !== 0 || within < paddedSize) throw new Error('tar が途中で切れています。');
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  } finally { reader.releaseLock(); }
  const assets: ArchiveAsset[] = [];
  for (const [guid, parts] of members) {
    // Directory-only entries lack an asset body.
    if (!parts.asset || !parts.pathname) continue;
    const path = utf8.decode(parts.pathname).replace(/[\r\n\0]+$/, '').replaceAll('\\', '/');
    if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(path)) {
      throw new Error('パッケージ内に無効なアセットパスがあります。');
    }
    assets.push({ guid, path, meta: utf8.decode(parts['asset.meta'] ?? new Uint8Array()), bytes: parts.asset });
  }
  if (assets.length === 0) throw new Error('Unity アセットが見つかりません。Unity が書き出した .unitypackage を選んでください。');
  return assets;
}
