import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { loadUnityPackage, resolveMaterial, resolveAssetPath } from './index.ts';

// A tiny, redistributable Unity-format fixture. No vendor avatar data is used.
const model = '11111111111111111111111111111111', mat = 'a'.repeat(32), texture = 'b'.repeat(32);
const prefab = 'c'.repeat(32), variant = 'd'.repeat(32), alternative = 'e'.repeat(32);
const enc = new TextEncoder();
type Member = [string, string | Uint8Array];

function tar(members: Member[]): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  for (const [path, value] of members) {
    const body = typeof value === 'string' ? enc.encode(value) : value;
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(enc.encode(s), at);
    put(path, 0); put('0000644\0', 100); put(body.length.toString(8).padStart(11, '0') + '\0', 124);
    put('        ', 148); put('0', 156); put('ustar\0', 257);
    put(h.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, body, new Uint8Array((512 - body.length % 512) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0)); let pos = 0;
  for (const block of blocks) { out.set(block, pos); pos += block.length; }
  return out;
}
function archive(members: Member[]) {
  return new Blob([Uint8Array.from(gzipSync(tar(members)))]);
}
function asset(guid: string, path: string, data: string, meta = ''): Member[] {
  return [[guid + '/asset', data], [guid + '/asset.meta', meta], [guid + '/pathname', path]];
}

const prologue = '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n';
const y = (...lines: string[]) => prologue + lines.join('\n') + '\n';
const modelMeta = ['ModelImporter:', '  internalIDToNameTable:', '  - first:', '      43: 4300002', '    second: Body',
  '  externalObjects:', '  - first:', '      type: UnityEngine:Material', '      name: Face',
  '    second: {fileID: 2100000, guid: ' + mat + ', type: 2}', '  meshes:', '    globalScale: 2'].join('\n');
const matData = (name: string) => y('--- !u!21 &2100000', 'Material:', '  m_Name: ' + name,
  '  m_Shader: {fileID: 4800000, guid: 85d6126cae43b6847aff4b13f4adb8ec, type: 3}',
  '  m_SavedProperties:', '    m_TexEnvs:', '    - _MainTex:', '        m_Texture: {fileID: 2800000, guid: ' + texture + ', type: 3}',
  '        m_Scale: {x: 2, y: 1}', '        m_Offset: {x: 0, y: 0.25}', '    m_Floats:', '    - _Cutoff: 0.42',
  '    m_Ints:', '    - _UseShadow: 1', '    m_Colors:', '    - _Color: {r: 1, g: 0.5, b: 0, a: 1}');
const prefabData = y('--- !u!1 &9007199254740992', 'GameObject:', '  m_Name: Other',
  '--- !u!1 &9007199254740993', 'GameObject:', '  m_Name: Avatar Body',
  '--- !u!33 &3300', 'MeshFilter:', '  m_GameObject: {fileID: 9007199254740993}', '  m_Mesh: {fileID: 4300002, guid: ' + model + ', type: 3}',
  '--- !u!23 &2300', 'MeshRenderer:', '  m_GameObject: {fileID: 9007199254740993}', '  m_Enabled: 1', '  m_Materials:',
  '  - {fileID: 2100000, guid: ' + alternative + ', type: 2}');
const variantData = y('--- !u!1001 &10010001', 'PrefabInstance:',
  '  m_SourcePrefab: {fileID: 100100000, guid: ' + prefab + ', type: 3}', '  m_Modification:', '    m_Modifications:',
  '    - target: {fileID: 2300, guid: ' + prefab + ', type: 3}', '      propertyPath: m_Materials.Array.data[0]',
  '      objectReference: {fileID: 2100000, guid: ' + mat + ', type: 2}');
test('index imported material names, GUID textures and variant renderer overrides; preserve 64-bit local IDs', async () => {
  const pkg = await loadUnityPackage(archive([
    ...asset(model, 'Assets/Model/avatar.FBX', 'FBX fixture', modelMeta),
    ...asset(mat, 'Assets/Materials/face.mat', matData('Face lilToon')),
    ...asset(alternative, 'Assets/Materials/other.mat', matData('Costume')),
    ...asset(texture, 'Assets/Textures/base map.png', 'image fixture'),
    ...asset(prefab, 'Assets/base.prefab', prefabData), ...asset(variant, 'Assets/green.prefab', variantData),
  ]));
  assert.deepEqual(pkg.warnings, []);
  const m = pkg.models[0];
  assert.equal(m.ext, '.fbx'); assert.equal(m.globalScale, 2);
  const bound = resolveMaterial(pkg, m, 'Body', 0, 'Face');
  assert.equal(bound?.guid, mat); assert.equal(bound.isLilToon, true); assert.equal(bound.shaderName, 'Hidden/lilToonCutout');
  assert.deepEqual({ ...bound.floats }, { _Cutoff: 0.42, _UseShadow: 1 });
  assert.deepEqual(bound.colors._Color, { r: 1, g: 0.5, b: 0, a: 1 });
  assert.deepEqual(bound.textures._MainTex, { guid: texture, offset: { x: 0, y: 0.25 }, scale: { x: 2, y: 1 } });
  assert.equal(resolveAssetPath(pkg, m.path, '../Textures/base%20map.png')?.guid, texture);
  assert.equal(resolveAssetPath(pkg, m.path, 'https://outside.example/base%20map.png'), undefined);
  const base = pkg.prefabs.find(p => p.guid === prefab)!, green = pkg.prefabs.find(p => p.guid === variant)!;
  assert.deepEqual(base.modelGuids, [model]); assert.equal(base.renderers[0].objectName, 'Avatar Body');
  assert.equal(resolveMaterial(pkg, m, 'Avatar_Body', 0, 'Face', base)?.guid, alternative);
  assert.equal(resolveMaterial(pkg, m, 'Avatar_Body', 0, 'Face', green)?.guid, mat);
});
test('reject invalid archives rather than indexing partial or unsafe paths', async () => {
  await assert.rejects(loadUnityPackage(new Blob(['not gzip'])), /gzip/);
  const good = tar(asset(model, 'Assets/a.fbx', 'x'));
  good[0] ^= 1;
  await assert.rejects(loadUnityPackage(new Blob([Uint8Array.from(gzipSync(good))])), /チェックサム/);
  await assert.rejects(loadUnityPackage(archive(asset(model, '../a.fbx', 'x'))), /無効なアセットパス/);
  const truncated = tar(asset(model, 'Assets/a.fbx', 'x')).slice(0, 513);
  await assert.rejects(loadUnityPackage(new Blob([Uint8Array.from(gzipSync(truncated))])), /途中/);
});
test('skip binary Unity YAML with a diagnostic and never guess between ambiguous texture paths', async () => {
  const pkg = await loadUnityPackage(archive([
    ...asset(model, 'Assets/Models/a.glb', 'model'),
    ...asset(texture, 'Assets/X/base.png', 'left'), ...asset(alternative, 'Assets/Y/base.png', 'right'),
    ...asset(mat, 'Assets/mat.mat', '\0\x01'),
  ]));
  assert.equal(pkg.warnings.length, 1); assert.match(pkg.warnings[0], /Assets\/mat.mat/);
  assert.equal(resolveAssetPath(pkg, pkg.models[0].path, 'base.png'), undefined);
});
