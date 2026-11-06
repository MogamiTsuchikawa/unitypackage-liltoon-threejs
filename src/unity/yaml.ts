import { parse } from 'yaml';
import type { UnityAsset, UnityMaterial, UnityColor, UnityTexture } from './types.ts';
import { lilToonShaders } from './shaders.ts';

export const utf8 = new TextDecoder();
const MAX_YAML = 16 * 1024 * 1024;
type Fields = Record<string, unknown>;
export const fields = (v: unknown): Fields => v && typeof v === 'object' && !Array.isArray(v) ? v as Fields : {};
export const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export const str = (v: unknown): string => typeof v === 'string' ? v : '';
export const num = (v: unknown, fallback: number): number => typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback;
export const refGuid = (v: unknown): string => str(fields(v).guid).toLowerCase();
export const refId = (v: unknown): string => str(fields(v).fileID);
const read = (s: string) => fields(parse(s, { schema: 'failsafe', maxAliasCount: 0, logLevel: 'silent' }));
export const dict = <T>(): Record<string, T> => Object.create(null);

// Parse only relevant document kinds, preserving all integer tokens as strings.
// Unity uses signed 64-bit local file IDs; JS numbers can alias adjacent IDs.
export function* documents(asset: UnityAsset, classes: string[], includeStripped = false) {
  if (asset.bytes.length > MAX_YAML) throw new Error('Unity YAML が 16 MiB を超えています');
  const text = utf8.decode(asset.bytes);
  const headers = [...text.matchAll(/^--- !u!(\d+) &(-?\d+)(?: stripped)?[ \t]*\r?$/gm)];
  if (!headers.length) throw new Error('テキスト形式の Unity YAML ではありません');
  const interesting = new Set(classes);
  for (let i = 0; i < headers.length; i++) {
    const [line, cls, id] = headers[i];
    if (!interesting.has(cls) || (!includeStripped && line.includes(' stripped'))) continue;
    const start = headers[i].index! + line.length;
    const root = read(text.slice(start, headers[i + 1]?.index));
    yield { cls, id, data: fields(Object.values(root)[0]) };
  }
}

export function indexModelMeta(asset: UnityAsset) {
  if (!asset.meta) return;
  const importer = fields(read(asset.meta).ModelImporter);
  asset.globalScale = num(fields(importer.meshes).globalScale, 1);
  for (const item of list(importer.externalObjects)) {
    const { first, second } = fields(item);
    const type = str(fields(first).type), name = str(fields(first).name), guid = refGuid(second);
    if (name && guid && (!type || /(?:^|[:.])Material$/.test(type))) asset.materialRemaps[name] = guid;
  }
  for (const [id, name] of Object.entries(fields(importer.fileIDToRecycleName))) asset.subAssetNames[id] = str(name);
  for (const item of list(importer.internalIDToNameTable)) {
    const { first, second } = fields(item);
    for (const id of Object.values(fields(first))) if (str(id)) asset.subAssetNames[str(id)] = str(second);
  }
}
function entries(v: unknown): [string, unknown][] {
  return Array.isArray(v) ? v.flatMap(pair => Object.entries(fields(pair))) : Object.entries(fields(v));
}
export function readMaterial(asset: UnityAsset, assets: Map<string, UnityAsset>): UnityMaterial {
  const first = documents(asset, ['21']).next();
  if (first.done) throw new Error('Material がありません');
  const data = first.value.data;
  const saved = fields(data.m_SavedProperties), floats = dict<number>(), colors = dict<UnityColor>(), textures = dict<UnityTexture>();
  for (const [key, val] of [...entries(saved.m_Floats), ...entries(saved.m_Ints)]) floats[key] = num(val, 0);
  for (const [key, val] of entries(saved.m_Colors)) {
    const c = fields(val);
    colors[key] = { r: num(c.r, 0), g: num(c.g, 0), b: num(c.b, 0), a: num(c.a, 1) };
  }
  for (const [key, val] of entries(saved.m_TexEnvs)) {
    const prop = fields(val), guid = refGuid(prop.m_Texture);
    if (!guid) continue;
    const s = fields(prop.m_Scale), o = fields(prop.m_Offset);
    textures[key] = { guid, scale: { x: num(s.x, 1), y: num(s.y, 1) }, offset: { x: num(o.x, 0), y: num(o.y, 0) } };
  }
  const shaderGuid = refGuid(data.m_Shader), shader = assets.get(shaderGuid);
  const declared = shader ? /^\s*Shader\s+"([^"]+)"/im.exec(utf8.decode(shader.bytes.subarray(0, 32 * 1024)))?.[1] : undefined;
  const shaderName = declared ?? lilToonShaders[shaderGuid] ?? '';
  // Custom lilToon shaders can be omitted from exports; use distinctive settings
  // only when no named shader is known. Old materials retain stale saved properties.
  const isLilToon = shaderName ? /liltoon/i.test(shaderName) : '_lilToonVersion' in floats || ('_UseMain2ndTex' in floats && '_Shadow2ndBorder' in floats);
  return { guid: asset.guid, path: asset.path, name: str(data.m_Name) || asset.name.slice(0, -4), shaderGuid, shaderName, isLilToon, floats, colors, textures, renderQueue: num(data.m_CustomRenderQueue, -1) };
}
