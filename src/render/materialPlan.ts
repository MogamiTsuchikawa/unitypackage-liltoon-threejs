import { LILTOON_PROPERTIES, LILTOON_TEXTURE_SEMANTICS, type LilToonShaderVariant } from '@mochiya/three-liltoon'
import type { UnityMaterial } from '../unity'

type UnityTexture = UnityMaterial['textures'][string]
type Value = number | number[]
const propertyInfo = new Map<string, {type: string; attributes: readonly string[]}>(
  LILTOON_PROPERTIES.map(p => [p.name, p]),
)
const supported: ReadonlySet<string> = new Set<LilToonShaderVariant>([
  'lilToon', 'Hidden/lilToonOutline', 'Hidden/lilToonCutout', 'Hidden/lilToonCutoutOutline',
  'Hidden/lilToonTransparent', 'Hidden/lilToonTransparentOutline', 'Hidden/lilToonOnePassTransparent',
  'Hidden/lilToonOnePassTransparentOutline', 'Hidden/lilToonTwoPassTransparent',
  'Hidden/lilToonTwoPassTransparentOutline', 'Hidden/lilToonFur', 'Hidden/lilToonFurCutout',
  'Hidden/lilToonFurTwoPass', 'Hidden/lilToonGem', 'Hidden/lilToonRefraction', 'Hidden/lilToonRefractionBlur',
])

// Unity stores editable sRGB colors alongside raw vectors in m_Colors. Match Mochiya's
// LilToonMaterialSerializer: linearize Color and [Gamma] floats, but never UV vectors.
const linear = (x: number) => x <= 0.04045 ? x / 12.92 : x < 1 ? ((x + 0.055) / 1.055) ** 2.4 : x ** 2.2

function approximateVariant(m: UnityMaterial): LilToonShaderVariant {
  const shader = m.shaderName.toLowerCase()
  const mode = m.floats._Mode ?? m.floats._TransparentMode
  const transparent = /fade|transparen|refract|gem/.test(shader) || mode === 2 || mode === 3 || m.renderQueue >= 3000
  const cutout = /cutout/.test(shader) || mode === 1 || m.renderQueue === 2450
  const outline = shader.includes('outline') || m.floats._UseOutline === 1
  if (transparent) return outline ? 'Hidden/lilToonTransparentOutline' : 'Hidden/lilToonTransparent'
  if (cutout) return outline ? 'Hidden/lilToonCutoutOutline' : 'Hidden/lilToonCutout'
  return outline ? 'Hidden/lilToonOutline' : 'lilToon'
}

export function materialPlan(m: UnityMaterial) {
  const native = supported.has(m.shaderName)
  const lilToon = native || m.isLilToon
  const shaderVariant = native ? m.shaderName as LilToonShaderVariant : approximateVariant(m)
  const properties: Record<string, Value> = {}
  const slots: Record<string, UnityTexture> = {}
  const setFloat = (key: string, from = key) => {
    if (m.floats[from] !== undefined) properties[key] = propertyInfo.get(key)?.attributes.includes('Gamma')
      ? linear(m.floats[from]) : m.floats[from]
  }
  const setColor = (key: string, from = key) => {
    const c = m.colors[from]
    if (!c) return
    properties[key] = propertyInfo.get(key)?.type === 'Color'
      ? [linear(c.r), linear(c.g), linear(c.b), c.a] : [c.r, c.g, c.b, c.a]
  }
  const setSlot = (key: string, from = key) => {
    if (m.textures[from]?.guid) slots[key] = m.textures[from]
  }
  if (lilToon) {
    for (const key of Object.keys(m.floats)) if (propertyInfo.has(key)) setFloat(key)
    for (const key of Object.keys(m.colors)) if (propertyInfo.has(key)) setColor(key)
    for (const key of Object.keys(m.textures)) if (Object.hasOwn(LILTOON_TEXTURE_SEMANTICS, key)) setSlot(key)
  } else {
    // Arktoon/Standard cannot be reproduced exactly. Map only equivalent settings;
    // old Unity materials can retain unrelated properties from previously used shaders.
    setColor('_Color', m.colors._Color ? '_Color' : '_BaseColor')
    setSlot('_MainTex', m.textures._MainTex?.guid ? '_MainTex' : '_BaseMap')
    for (const key of ['_BumpMap', '_EmissionMap']) setSlot(key)
    for (const key of ['_Cutoff', '_BumpScale', '_Cull']) setFloat(key)
    for (const key of ['_EmissionColor', '_OutlineColor']) setColor(key)
    properties._UseShadow = Number(m.floats._ShadowStrength === undefined || m.floats._ShadowStrength > 0)
    properties._UseBumpMap = Number(!!slots._BumpMap)
    properties._UseEmission = Number(!!slots._EmissionMap || (m.colors._EmissionColor && Math.max(m.colors._EmissionColor.r, m.colors._EmissionColor.g, m.colors._EmissionColor.b) > 0) || false)
    if (/arktoon/i.test(m.shaderName)) {
      setFloat('_Cull', '_CullMode')
      if (m.floats._UseDoubleSided === 1) properties._Cull = 0
      for (const key of ['_ShadowStrength', '_OutlineWidth', '_UseRim']) setFloat(key)
      setFloat('_ShadowBorder', '_Shadowborder')
      setFloat('_ShadowBlur', '_ShadowborderBlur')
      setColor('_ShadowColor', m.floats._ShadowPlanBUsePlanB === 1 ? '_ShadowPlanBCustomShadowTextureRGB' : '_ShadowColor')
      setColor('_RimColor')
      setColor('_MatCapColor', '_MatcapColor')
      setSlot('_MatCapTex', '_MatcapTexture')
      setSlot('_MatCapBlendMask', '_MatcapBlendMask')
      for (const key of ['_OutlineWidthMask', '_ShadowStrengthMask']) setSlot(key)
      properties._UseMatCap = Number(!!slots._MatCapTex && m.floats._MatcapBlend !== 0)
    }
  }
  // -1 inherits the Unity shader's Queue tag, not a single opaque/transparent
  // default. In particular, ordinary lilToon transparency uses AlphaTest+10.
  const inheritedQueue = shaderVariant.includes('Cutout') ? 2450
    : shaderVariant.includes('Transparent') ? 2460
    : shaderVariant.includes('Fur') ? 3000
    : /Refraction|Gem/.test(shaderVariant) ? 2900 : 2000
  const renderQueue = Number.isInteger(m.renderQueue) && m.renderQueue >= 0 && m.renderQueue <= 5000
    ? m.renderQueue : inheritedQueue
  return { native, shaderVariant, properties, slots, renderQueue }
}
