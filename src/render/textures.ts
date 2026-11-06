import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, MirroredRepeatWrapping,
  NearestFilter, NearestMipmapNearestFilter, RepeatWrapping, Texture } from 'three'
import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import type { UnityAsset } from '../unity'

export type UvConvention = 'fbx' | 'gltf'

const mimes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.gif': 'image/gif', '.avif': 'image/avif',
}
const numberSetting = (meta: string, key: string) => {
  const value = meta.match(new RegExp('^\\s*' + key + ':\\s*(-?\\d+)', 'm'))
  return value ? Number(value[1]) : undefined
}
const wrap = (v: number | undefined) => v === 1 ? ClampToEdgeWrapping : v === 2 ? MirroredRepeatWrapping : RepeatWrapping

export async function decodeTexture(asset: UnityAsset, uv: UvConvention) {
  let texture: Texture
  const flip = uv === 'fbx'
  if (asset.ext === '.tga') {
    const bytes = asset.bytes
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.length < 18 || header.getUint16(12, true) * header.getUint16(14, true) > 8192 ** 2)
      throw new Error('TGA の寸法が無効または大きすぎます')
    const { data, width, height } = new TGALoader().parse(bytes.slice().buffer)
    if (!data || !width || !height) throw new Error('TGA の画素がありません')
    // TGALoader returns top-first rows; three-liltoon texture views force flipY=false.
    if (flip) {
      const pitch = width * 4
      const row = new Uint8Array(pitch)
      for (let y = 0; y < Math.floor(height / 2); y++) {
        const a = y * pitch, b = (height - 1 - y) * pitch
        row.set(data.subarray(a, a + pitch))
        data.copyWithin(a, b, b + pitch)
        data.set(row, b)
      }
    }
    texture = new DataTexture(data, width, height)
  } else {
    const mime = mimes[asset.ext]
    if (!mime) throw new Error('未対応の画像形式 ' + asset.ext)
    // Upload already oriented pixels: WebGL ignores unpack flipY for ImageBitmap.
    const image = await createImageBitmap(new Blob([asset.bytes], {type: mime}), {
      imageOrientation: flip ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    })
    texture = new Texture(image)
  }
  texture.name = asset.path
  texture.flipY = false
  texture.wrapS = wrap(numberSetting(asset.meta, 'wrapU') ?? numberSetting(asset.meta, 'wrapMode'))
  texture.wrapT = wrap(numberSetting(asset.meta, 'wrapV') ?? numberSetting(asset.meta, 'wrapMode'))
  texture.generateMipmaps = numberSetting(asset.meta, 'enableMipMap') !== 0
  const point = numberSetting(asset.meta, 'filterMode') === 0
  texture.magFilter = point ? NearestFilter : LinearFilter
  texture.minFilter = texture.generateMipmaps ? (point ? NearestMipmapNearestFilter : LinearMipmapLinearFilter) : texture.magFilter
  texture.needsUpdate = true
  return texture
}

export function disposeTexture(texture: Texture) {
  texture.dispose()
  const image = texture.image
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}
