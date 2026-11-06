import {
  AnimationClip, BufferAttribute, BufferGeometry, Group, Material, Mesh, Object3D, Skeleton, SkinnedMesh, Texture,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLilToonExtension } from '@mochiya/three-liltoon/gltf';
import { LilToonMaterial } from '@mochiya/three-liltoon';
import { createMaterialLibrary } from '../render/materials';
import { resolveAssetPath, resolveMaterial, resolveRenderer, type UnityPackage } from '../unity';
import type { ModelChoice } from './choices';
import { ModelResources } from './resources';
import { readVrmSprings, readUnitySprings, type AuthoredSpring } from './authoredSprings';
import { readUnityClips } from '../motion/unityClips';

export { listModelChoices, type ModelChoice } from './choices';
export interface ModelStats {
  meshes: number; materials: number; textures: number; vertices: number; triangles: number;
  nativeMaterials: number; convertedMaterials: number;
}
export interface LoadedModel {
  root: Group;
  clips: AnimationClip[];
  springs: AuthoredSpring[];
  stats: ModelStats;
  warnings: string[];
  dispose(): void;
}

async function parseModel(pkg: UnityPackage, choice: ModelChoice, resources: ModelResources, warnings: string[]) {
  const { model } = choice;
  const { manager } = resources;
  if (model.ext === '.obj') {
    const source = new TextDecoder().decode(model.bytes);
    const loader = new OBJLoader(manager);
    const mtlName = /^\s*mtllib\s+([^\r\n]+)/m.exec(source)?.[1].trim();
    const mtl = mtlName && resolveAssetPath(pkg, model.path, mtlName);
    if (mtl) loader.setMaterials(new MTLLoader(manager).parse(new TextDecoder().decode(mtl.bytes), mtl.path.slice(0, mtl.path.lastIndexOf('/') + 1)));
    const root = loader.parse(source);
    root.scale.multiplyScalar(model.globalScale);
    return { root, clips: root.animations, springs: [] as AuthoredSpring[] };
  }
  const { bytes } = model;
  const data = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (model.ext === '.fbx') {
    const root = new FBXLoader(manager).parse(data, '');
    // FBX UnitScaleFactor is cm per unit. Unity's globalScale is an additional multiplier.
    const unit = Number(root.userData.unitScaleFactor) || 1;
    const wrapper = new Group();
    wrapper.scale.setScalar(unit * model.globalScale * 0.01);
    wrapper.add(root);
    return { root: wrapper, clips: root.animations, springs: [] as AuthoredSpring[] };
  }
  if (!['.glb', '.gltf', '.vrm'].includes(model.ext)) throw new Error(`未対応のモデル形式: ${model.ext}`);
  const loader = new GLTFLoader(manager);
  loader.register(parser => new GLTFLilToonExtension(parser, { onWarning: issue => warnings.push(issue.materialName + ': ' + issue.message) }));
  const gltf = await loader.parseAsync(data, '');
  const root = gltf.scene;
  // VRM 0.x avatars conventionally look towards -Z; VRM 1.0 faces +Z.
  if (model.ext === '.vrm' && gltf.parser.json.extensions?.VRM) root.rotation.y += Math.PI;
  root.scale.multiplyScalar(model.globalScale);
  const nodes = new Map<number, Object3D>();
  root.traverse(node => {
    const index = gltf.parser.associations.get(node)?.nodes;
    if (index !== undefined) nodes.set(index, node);
  });
  return { root, clips: gltf.animations, springs: readVrmSprings(gltf.parser.json, nodes) };
}

function texturesOf(material: Material): Texture[] {
  const textures = Object.values(material).filter((value): value is Texture => value?.isTexture === true);
  if (material instanceof LilToonMaterial) {
    for (const texture of Object.values(material.lilToonTextures)) if (texture) textures.push(texture);
  }
  return textures;
}

/** Directly constructed lilToon materials need tangent frames for normals and anisotropy. */
function prepareGeometry(mesh: Mesh, materials: Material[]) {
  const g = mesh.geometry;
  if (!g.attributes.normal && g.attributes.position) g.computeVertexNormals();
  if (!g.attributes.uv || !g.attributes.normal || !g.attributes.position || g.attributes.tangent) return;
  const needs = materials.some(m => m instanceof LilToonMaterial && (
    m.featureSet.normal1st || m.featureSet.normal2nd || m.featureSet.anisotropy ||
    m.lilToonTextures._OutlineVectorTex || m.lilToonTextures._MatCapBumpMap || m.lilToonTextures._MatCap2ndBumpMap
  ));
  if (!needs) return;
  // FBXLoader emits non-indexed triangles, while computeTangents requires indices.
  if (!g.index) {
    const n = g.attributes.position.count;
    const indices = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    g.setIndex(new BufferAttribute(indices, 1));
  }
  g.computeTangents();
}

export async function loadModel(pkg: UnityPackage, choice: ModelChoice): Promise<LoadedModel> {
  const { model, prefab } = choice;
  const resources = new ModelResources(pkg, model);
  const isGltf = ['.glb', '.gltf', '.vrm'].includes(model.ext);
  const library = createMaterialLibrary(pkg, isGltf ? 'gltf' : 'fbx');
  const warnings: string[] = [], originals = new Set<Material>(), geometries = new Set<BufferGeometry>();
  const skeletons = new Set<Skeleton>(), importedMaps = new Set<Texture>(), used = new Set<Material>(), usedImportedMaps = new Set<Texture>();
  const stats: ModelStats = { meshes: 0, materials: 0, textures: 0, vertices: 0, triangles: 0, nativeMaterials: 0, convertedMaterials: 0 };
  let disposed = false, root: Group | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    root?.removeFromParent();
    library.dispose();
    for (const m of originals) m.dispose();
    for (const t of importedMaps) {
      t.dispose();
      if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
    }
    for (const s of skeletons) s.dispose();
    for (const g of geometries) g.dispose();
    root?.clear();
  }
  try {
    let parsed: Awaited<ReturnType<typeof parseModel>>;
    try { parsed = await parseModel(pkg, choice, resources, warnings); root = parsed.root; }
    finally { await resources.finish(!!root); }
    const meshes: Mesh[] = [], geometryUse = new Map<BufferGeometry, number>();
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      meshes.push(object);
      geometries.add(object.geometry);
      geometryUse.set(object.geometry, (geometryUse.get(object.geometry) ?? 0) + 1);
      if (object instanceof SkinnedMesh && object.skeleton) skeletons.add(object.skeleton);
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        originals.add(m);
        for (const t of texturesOf(m)) importedMaps.add(t);
      }
    });
    if (!meshes.length) throw new Error(`${model.name} に描画可能なメッシュがありません。`);
    let fallbackUsed = false;
    for (const mesh of meshes) {
      const g = mesh.geometry, sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const meshName = String(mesh.userData.originalName || mesh.name);
      const renderer = resolveRenderer(prefab, model.guid, meshName);
      if (renderer && !renderer.enabled) { mesh.visible = false; continue; }
      // Unity material slots are packed in first-polygon order. An FBX material array can
      // contain unused entries anywhere (including slot zero); it is not a prefab slot list.
      const drawn = Array.isArray(mesh.material) && g.groups.length
        ? [...new Set(g.groups.map(group => group.materialIndex ?? 0))] : [0];
      const bound = sources.slice();
      for (const [slot, index] of drawn.entries()) {
        const original = sources[index];
        if (!original) throw new Error(`${meshName}: マテリアルスロット ${index} が見つかりません。`);
        const unity = resolveMaterial(pkg, model, meshName, slot, original.name, prefab);
        let next: Material;
        if (unity) next = await library.load(unity);
        else if (original instanceof LilToonMaterial) {
          next = original;
          next.userData.shaderSource = 'lilToon';
          texturesOf(original).forEach(t => usedImportedMaps.add(t));
        } else {
          next = library.fallback(original);
          fallbackUsed = true;
          texturesOf(original).forEach(t => usedImportedMaps.add(t));
        }
        bound[index] = next;
        used.add(next);
      }
      const active = [...new Set(drawn.map(i => bound[i]))];
      prepareGeometry(mesh, active);
      // Preserve face order but avoid redundant draw calls for contiguous groups backed by the same .mat.
      if (active.length === 1) mesh.material = active[0];
      else {
        mesh.material = bound;
        if (geometryUse.get(g) === 1) {
          const groups = g.groups; g.clearGroups();
          for (const group of groups) {
            const previous = g.groups.at(-1);
            if (previous && previous.start + previous.count === group.start && bound[previous.materialIndex ?? 0] === bound[group.materialIndex ?? 0]) previous.count += group.count;
            else g.addGroup(group.start, group.count, group.materialIndex ?? 0);
          }
        }
      }
      stats.meshes++;
      stats.vertices += g.attributes.position?.count ?? 0;
      stats.triangles += (g.index?.count ?? g.attributes.position?.count ?? 0) / 3;
    }
    if (!stats.meshes) throw new Error('有効なメッシュがありません。元のモデルを選択してください。');
    if (fallbackUsed) warnings.push('Unity マテリアルが指定されていない面は、モデル内のマテリアルから lilToon に変換しました。');
    if ((isGltf || fallbackUsed) && resources.missing.size) warnings.push('モデルから参照される画像がありません: ' + [...resources.missing].join(', '));
    if (prefab && prefab.modelGuids.length > 1) warnings.push('複数モデルを参照する Prefab のうち、選択されたモデルのみ表示しています。');
    stats.materials = used.size;
    stats.nativeMaterials = [...used].filter(m => m.userData.shaderSource === 'lilToon').length;
    stats.convertedMaterials = stats.materials - stats.nativeMaterials;
    stats.textures = library.textureCount + usedImportedMaps.size;
    root.updateMatrixWorld(true);
    const unityMotion = readUnityClips(pkg, root, model);
    warnings.push(...unityMotion.warnings);
    const clips = [...parsed.clips, ...unityMotion.clips];
    root.animations = clips;
    const springs = parsed.springs.length ? parsed.springs : readUnitySprings(pkg, model, root, prefab?.guid, warnings);
    return { root, clips, springs, stats, warnings: [...new Set([...warnings, ...library.warnings])], dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
