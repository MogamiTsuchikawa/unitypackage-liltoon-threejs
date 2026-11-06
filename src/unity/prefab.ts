import type { UnityAsset, UnityPrefab, UnityRenderer } from './types.ts';
import { documents, fields, list, str, refId, refGuid } from './yaml.ts';

interface ResolvedRenderer extends UnityRenderer { id: string; gameId: string }
interface Override { targetId: string; targetGuid: string; path: string; guid: string; value: string }
interface Instance { source: string; overrides: Override[] }
interface RawPrefab { asset: UnityAsset; renderers: ResolvedRenderer[]; instances: Instance[] }

export function readPrefab(asset: UnityAsset, models: Map<string, UnityAsset>): RawPrefab {
  const docs = [...documents(asset, ['1', '4', '23', '33', '137', '1001'])];
  const objects = new Map<string, { name: string; enabled: boolean }>();
  const filters = new Map<string, unknown>(), transforms = new Map<string, string>(), parents = new Map<string, string>();
  const renderers: ResolvedRenderer[] = [], instances: Instance[] = [];
  for (const { cls, data, id } of docs) {
    if (cls === '1') objects.set(id, { name: str(data.m_Name), enabled: data.m_IsActive !== '0' });
    if (cls === '33') filters.set(refId(data.m_GameObject), data.m_Mesh);
    if (cls === '4') {
      transforms.set(refId(data.m_GameObject), id); parents.set(id, refId(data.m_Father));
    }
    if (cls === '1001') {
      instances.push({
        source: refGuid(data.m_SourcePrefab),
        overrides: list(fields(data.m_Modification).m_Modifications).map(entry => {
          const mod = fields(entry);
          return { targetId: refId(mod.target), targetGuid: refGuid(mod.target), path: str(mod.propertyPath), guid: refGuid(mod.objectReference), value: str(mod.value) };
        }).filter(m => m.path === 'm_Enabled' || m.path === 'm_IsActive' || m.path.startsWith('m_Materials.Array.data[')),
      });
    }
  }
  const inactive = new Set<string>();
  for (const [gameId, info] of objects) if (!info.enabled) inactive.add(transforms.get(gameId) ?? '');
  function activeHierarchy(gameId: string): boolean {
    const seen = new Set<string>();
    let transform = transforms.get(gameId);
    while (transform && !seen.has(transform)) {
      if (inactive.has(transform)) return false;
      seen.add(transform); transform = parents.get(transform);
    }
    return true;
  }
  for (const { cls, data, id } of docs) {
    if (cls !== '137' && cls !== '23') continue;
    const gameId = refId(data.m_GameObject), object = objects.get(gameId);
    const mesh = cls === '23' ? filters.get(gameId) : data.m_Mesh, model = models.get(refGuid(mesh));
    if (!model) continue;
    renderers.push({
      id, gameId, modelGuid: model.guid,
      meshName: model.subAssetNames[refId(mesh)] || object?.name || '',
      objectName: object?.name || '',
      enabled: data.m_Enabled !== '0' && activeHierarchy(gameId),
      materialGuids: list(data.m_Materials).map(refGuid),
    });
  }
  return { asset, renderers, instances };
}

interface Expanded { modelGuids: Set<string>; renderers: ResolvedRenderer[] }

export function linkPrefabs(raw: Map<string, RawPrefab>, models: Map<string, UnityAsset>, warnings: string[]): UnityPrefab[] {
  const memo = new Map<string, Expanded>();
  function expand(prefab: RawPrefab, parents: Set<string>): Expanded {
    const cached = memo.get(prefab.asset.guid);
    if (cached) return cached;
    if (parents.has(prefab.asset.guid) || parents.size > 32) throw new Error('Prefab の参照が循環、または深すぎます');
    const next = new Set(parents).add(prefab.asset.guid);
    const result = { modelGuids: new Set(prefab.renderers.map(r => r.modelGuid)), renderers: [...prefab.renderers] };
    for (const instance of prefab.instances) {
      const model = models.get(instance.source), parent = raw.get(instance.source);
      let local: ResolvedRenderer[] = [];
      if (model) result.modelGuids.add(model.guid);
      else if (parent) {
        const inherited = expand(parent, next);
        for (const guid of inherited.modelGuids) result.modelGuids.add(guid);
        local = inherited.renderers.map(r => ({ ...r, materialGuids: [...r.materialGuids] }));
      } else continue;
      for (const mod of instance.overrides) {
        if (mod.targetGuid !== instance.source) continue;
        const slot = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(mod.path);
        const name = model?.subAssetNames[mod.targetId];
        let renderer = local.find(r => r.id === mod.targetId || r.gameId === mod.targetId || (name && (r.objectName === name || r.meshName === name)));
        if (!renderer && model && name) {
          renderer = { id: mod.targetId, gameId: '', modelGuid: model.guid, objectName: name, meshName: name, materialGuids: [], enabled: true };
          local.push(renderer);
        }
        if (!renderer) continue;
        if (slot && +slot[1] < 1024) renderer.materialGuids[+slot[1]] = mod.guid;
        else if (mod.path === 'm_Enabled' || mod.path === 'm_IsActive') renderer.enabled = mod.value !== '0';
      }
      if (result.renderers.length + local.length > 8192) throw new Error('Prefab に含まれるレンダラーが多すぎます');
      result.renderers.push(...local);
    }
    memo.set(prefab.asset.guid, result);
    return result;
  }
  const prefabs: UnityPrefab[] = [];
  for (const prefab of raw.values()) {
    try {
      const linked = expand(prefab, new Set());
      prefabs.push({ guid: prefab.asset.guid, path: prefab.asset.path, name: prefab.asset.name.slice(0, -7), modelGuids: [...linked.modelGuids], renderers: linked.renderers });
    } catch (err) { warnings.push(prefab.asset.path + ': ' + (err instanceof Error ? err.message : 'Prefab を読み込めません')); }
  }
  const rank = (name: string) => /(?:^|[_ -])(standard|default)(?:$|[_ -])/i.test(name) ? 0 : 1;
  prefabs.sort((a, b) => rank(a.name) - rank(b.name) || a.path.localeCompare(b.path));
  return prefabs;
}
