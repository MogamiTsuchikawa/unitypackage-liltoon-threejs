import { LilToonMaterial } from '@mochiya/three-liltoon'
import { BackSide, DoubleSide, type Color, type Material, type Texture } from 'three'
import type { UnityMaterial, UnityPackage } from '../unity'
import { materialPlan } from './materialPlan'
import { decodeTexture, disposeTexture, type UvConvention } from './textures'

export function createMaterialLibrary(pkg: UnityPackage, uv: UvConvention = 'fbx') {
  const materials = new Map<string, Promise<LilToonMaterial>>()
  const fallbacks = new WeakMap<Material, LilToonMaterial>()
  const textures = new Map<string, Promise<Texture>>()
  const ownedMaterials = new Set<LilToonMaterial>()
  const ownedTextures = new Set<Texture>()
  const warnings: string[] = []
  let disposed = false
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message) }
  async function build(source: UnityMaterial): Promise<LilToonMaterial> {
    const { native, shaderVariant, properties, slots, renderQueue } = materialPlan(source)
    const assigned: Record<string, Texture> = {}
    const sourceShader = source.shaderName || (source.isLilToon ? 'lilToon (バリアント不明)' : '不明なシェーダー')
    if (!native) warn(source.name + ': ' + sourceShader + ' を ' + shaderVariant + ' に近似変換しました。')
    await Promise.all(Object.entries(slots).map(async ([property, {guid, scale, offset}]) => {
      const asset = pkg.assets.get(guid)
      if (!asset) {
        warn(source.name + ': ' + property + ' の画像がパッケージにありません（' + guid + '）。')
        return
      }
      if (property === '_ReflectionCubeTex') {
        warn(source.name + ': Unity Cubemap には対応していません（' + asset.name + '）。')
        return
      }
      let promise = textures.get(guid)
      if (!promise) {
        promise = decodeTexture(asset, uv).then(texture => {
          if (disposed) {
            disposeTexture(texture)
            throw new Error('読み込みが終了しました')
          }
          ownedTextures.add(texture)
          return texture
        })
        textures.set(guid, promise)
      }
      try {
        assigned[property] = await promise
        properties[property + '_ST'] = [scale.x, scale.y, offset.x,
          uv === 'gltf' ? 1 - scale.y - offset.y : offset.y]
      } catch (error) {
        warn(source.name + ': ' + property + ' / ' + asset.name + ' を読み込めません（' +
          (error instanceof Error ? error.message : String(error)) + '）。')
      }
    }))
    if (disposed) throw new Error('マテリアルの読み込みは終了しました')
    const material = new LilToonMaterial({
      name: source.name, properties, textures: assigned, shaderVariant, deformation: true, renderQueue,
    })
    material.userData.shaderSource = native ? 'lilToon' : 'converted'
    material.userData.sourceShader = sourceShader
    material.userData.sourcePath = source.path
    ownedMaterials.add(material)
    for (const issue of material.getWarnings()) warn(source.name + ': ' + issue.message)
    return material
  }
  return {
    warnings,
    get textureCount() { return ownedTextures.size },
    load(source: UnityMaterial): Promise<LilToonMaterial> {
      let promise = materials.get(source.guid)
      if (!promise) {
        promise = build(source)
        materials.set(source.guid, promise)
      }
      return promise
    },
    fallback(original: Material) {
      const existing = fallbacks.get(original)
      if (existing) return existing
      const from = original as Material & {color?: Color; map?: Texture | null}
      const color = from.color
      const map = from.map
      // When a loader expects flipY=true, compensate in UVs since the shader's
      // texture views always use flipY=false. Do not modify the FBX material/map.
      const uvST = map ? [map.repeat.x, map.flipY ? -map.repeat.y : map.repeat.y,
        map.offset.x, map.flipY ? 1 - map.offset.y : map.offset.y] : [1, 1, 0, 0]
      const material = new LilToonMaterial({
        name: original.name, deformation: true,
        shaderVariant: original.transparent ? 'Hidden/lilToonTransparent' : original.alphaTest > 0 ? 'Hidden/lilToonCutout' : 'lilToon',
        properties: { _Color: [color?.r ?? 1, color?.g ?? 1, color?.b ?? 1, original.opacity],
          _MainTex_ST: uvST, _UseShadow: 1, _Cutoff: original.alphaTest,
          _Cull: original.side === DoubleSide ? 0 : original.side === BackSide ? 1 : 2 },
        textures: map ? { _MainTex: map } : undefined,
      })
      material.userData.shaderSource = 'fallback'
      material.userData.sourceShader = original.type
      fallbacks.set(original, material)
      ownedMaterials.add(material)
      return material
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const material of ownedMaterials) material.dispose()
      for (const texture of ownedTextures) disposeTexture(texture)
      ownedMaterials.clear()
      ownedTextures.clear()
      materials.clear()
      textures.clear()
    },
  }
}
