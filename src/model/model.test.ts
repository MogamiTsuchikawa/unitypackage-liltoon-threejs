import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { type BufferGeometry, Mesh } from 'three';
import type { UnityAsset, UnityMaterial, UnityPackage, UnityPrefab } from '../unity';
import { listModelChoices, loadModel } from './index';

function asset(name: string, bytes: Uint8Array<ArrayBuffer>): UnityAsset {
  return { guid: '1'.repeat(32), path: 'Assets/' + name, ext: name.slice(name.lastIndexOf('.')),
    name, bytes, meta: '', globalScale: 1, materialRemaps: {}, subAssetNames: {} };
}
function makePackage(model: UnityAsset, materials: UnityMaterial[] = [], prefabs: UnityPrefab[] = []): UnityPackage {
  return { assets: new Map([[model.guid, model]]), models: [model], materials: new Map(materials.map(m => [m.guid, m])), prefabs, warnings: [] };
}
function material(name: string, id: string): UnityMaterial {
  return { name, guid: id.repeat(32), path: 'Assets/' + name + '.mat', shaderGuid: '', shaderName: 'lilToon', isLilToon: true,
    floats: {}, colors: {}, textures: {}, renderQueue: -1 };
}
test('bind prefab slots to drawn FBX polygons when unused FBX slots interleave the two overrides', async () => {
  // Three faces reference FBX slots [3, 1, 3]; slots 0 and 2 exist but are never drawn.
  const bytes = await readFile(new URL('./fixtures/sparse.fbx', import.meta.url));
  const model = asset('Avatar.fbx', Uint8Array.from(bytes)), face = material('Face', 'a'), suit = material('Costume', 'b');
  const variant = { modelGuid: model.guid, meshName: 'Body', objectName: 'Body', enabled: true, materialGuids: [face.guid, suit.guid] };
  const prefab = { guid: '2'.repeat(32), path: 'Assets/Avatar.prefab', name: 'Avatar', modelGuids: [model.guid], renderers: [variant] };
  const pkg = makePackage(model, [face, suit], [prefab]);
  const choice = listModelChoices(pkg)[0];
  assert.equal(choice.prefab, prefab);
  const imported = await loadModel(pkg, choice);
  try {
    const mesh = imported.root.getObjectByName('Body');
    assert.ok(mesh instanceof Mesh && Array.isArray(mesh.material));
    const geometry: BufferGeometry = mesh.geometry;
    assert.deepEqual(geometry.groups.map(g => mesh.material[g.materialIndex ?? 0].name), ['Face', 'Costume', 'Face']);
    assert.equal(imported.stats.nativeMaterials, 2);
    assert.equal(imported.stats.triangles, 3);
    assert.equal(imported.stats.convertedMaterials, 0);
  } finally { imported.dispose(); }
});

test('reject a missing glTF buffer without an extension instead of reading white image bytes as vertices', { timeout: 3000 }, async () => {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0,
      componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ uri: 'missing_vertices', byteLength: 36 }] };
  const pkg = makePackage(asset('triangle.gltf', new TextEncoder().encode(JSON.stringify(json))));
  await assert.rejects(loadModel(pkg, listModelChoices(pkg)[0]), /モデルが参照するデータがありません: missing_vertices/);
});
