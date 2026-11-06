import { readClipAsset } from './clip';
import { readArchive } from './archive.ts';
import type { UnityAsset, UnityMaterial, UnityPackage, UnityPrefab } from './types.ts';
import { indexModelMeta, readMaterial, dict } from './yaml.ts';
import { readPrefab, linkPrefabs } from './prefab.ts';
export type * from './types.ts';

const modelExtensions = new Set(['.fbx', '.glb', '.gltf', '.vrm', '.obj']);

export async function loadUnityPackage(file: Blob, progress?: (phase: string) => void): Promise<UnityPackage> {
  progress?.('アーカイブを展開中');
  const source = await readArchive(file);
  progress?.('マテリアルとモデルの参照を解析中');
  const assets = new Map<string, UnityAsset>(), models = new Map<string, UnityAsset>(), materials = new Map<string, UnityMaterial>();
  const raw = new Map<string, ReturnType<typeof readPrefab>>(), warnings: string[] = [];
  const warn = (path: string, err: unknown) => warnings.push(path + ': ' + (err instanceof Error ? err.message.split('\n')[0] : '読み込めません'));
  for (const a of source) {
    const name = a.path.slice(a.path.lastIndexOf('/') + 1), ext = (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase();
    const asset: UnityAsset = { ...a, name, ext, materialRemaps: dict(), subAssetNames: dict(), globalScale: 1 };
    assets.set(a.guid, asset);
    if (modelExtensions.has(ext)) {
      models.set(a.guid, asset);
      try { indexModelMeta(asset); } catch (err) { warn(asset.path + '.meta', err); }
    }
  }
  for (const a of assets.values()) {
    try {
      if (a.ext === '.anim') a.clip = readClipAsset(a);
      if (a.ext === '.mat') materials.set(a.guid, readMaterial(a, assets));
      if (a.ext === '.prefab') raw.set(a.guid, readPrefab(a, models));
    } catch (err) { warn(a.path, err); }
  }
  const prefabs = linkPrefabs(raw, models, warnings);
  const use = new Map<string, number>();
  for (const p of prefabs) for (const guid of p.modelGuids) use.set(guid, (use.get(guid) ?? 0) + 1);
  const ranked = [...models.values()].sort((a, b) => (use.get(b.guid) ?? 0) - (use.get(a.guid) ?? 0) || b.bytes.length - a.bytes.length || a.path.localeCompare(b.path));
  return { assets, models: ranked, materials, prefabs, warnings };
}

const norm = (name: string) => name.replace(/^.*::/, '').replace(/\s+/g, '_').replace(/[\[\].:/]/g, '').toLowerCase();

// FBX object and geometry names need not be equal. Prefer an exact match,
// then the sanitization used by Three.js for names in animation bindings.
export function resolveRenderer(prefab: UnityPrefab | undefined, modelGuid: string, meshName: string) {
  const candidates = prefab?.renderers.filter(r => r.modelGuid === modelGuid) ?? [];
  return candidates.find(r => r.objectName === meshName) ?? candidates.find(r => r.meshName === meshName)
    ?? candidates.find(r => norm(r.objectName) === norm(meshName)) ?? candidates.find(r => norm(r.meshName) === norm(meshName));
}

export function resolveMaterial(pkg: UnityPackage, model: UnityAsset, meshName: string, slotIndex: number, sourceMaterialName: string, prefab?: UnityPrefab): UnityMaterial | undefined {
  const prefabRef = resolveRenderer(prefab, model.guid, meshName)?.materialGuids[slotIndex];
  if (prefabRef) return pkg.materials.get(prefabRef);
  const key = norm(sourceMaterialName);
  const mapped = model.materialRemaps[sourceMaterialName] || Object.entries(model.materialRemaps).find(([name]) => norm(name) === key)?.[1];
  if (mapped) return pkg.materials.get(mapped);
  const candidates = [...pkg.materials.values()].filter(m => norm(m.name) === key || norm(m.path.split('/').pop()!.slice(0, -4)) === key);
  return candidates.length === 1 ? candidates[0] : undefined;
}

// Resolve model dependencies exclusively inside the selected archive. A basename
// may match an exported texture from a moved folder, but never guess between two.
export function resolveAssetPath(pkg: UnityPackage, modelPath: string, uri: string): UnityAsset | undefined {
  let clean: string;
  try { clean = decodeURIComponent(uri.split(/[?#]/)[0]).replaceAll('\\', '/'); } catch { return; }
  if (!clean || clean.startsWith('//') || /^[a-z][\w+.-]*:/i.test(clean) || clean.includes('\0')) return;
  const parts = /^(Assets|Packages)\//.test(clean) ? [] : modelPath.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (part === '..') { if (parts.length <= 1) return; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  const target = parts.join('/').toLowerCase(), base = parts.at(-1)?.toLowerCase();
  const all = [...pkg.assets.values()];
  const exact = all.filter(a => a.path.toLowerCase() === target);
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const same = all.filter(a => a.name.toLowerCase() === base);
  return same.length === 1 ? same[0] : undefined;
}
