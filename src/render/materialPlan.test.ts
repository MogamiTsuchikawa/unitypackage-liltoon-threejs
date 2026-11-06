import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UnityMaterial } from '../unity'
import { materialPlan } from './materialPlan'

const map = { guid: '001', scale: {x: 2, y: 3}, offset: {x: 0.1, y: 0.2} }
const base: UnityMaterial = {
  guid: '002', name: 'test', path: 'Assets/test.mat', shaderName: '', shaderGuid: '',
  isLilToon: true, renderQueue: 3000, textures: {_MainTex: map}, floats: {_UseOutline: 1},
  colors: {_Color: {r: 0.5, g: 1, b: 0, a: 0.5}, _MainTexHSVG: {r: 0.5, g: 1, b: 1, a: 1}},
}
test('native shader wins over stale properties; only color channels are converted to linear light', () => {
  const plan = materialPlan({...base, shaderName: 'Hidden/lilToonTransparent'})
  assert.equal(plan.native, true)
  assert.equal(plan.shaderVariant, 'Hidden/lilToonTransparent')
  assert.equal(plan.renderQueue, 3000)
  assert.equal(materialPlan({...base, shaderName: 'Hidden/lilToonTransparent', renderQueue: -1}).renderQueue, 2460)
  assert.deepEqual(plan.properties._Color, [0.21404114048223255, 1, 0, 0.5])
  assert.deepEqual(plan.properties._MainTexHSVG, [0.5, 1, 1, 1])
  assert.deepEqual(plan.slots._MainTex, map)
})
test('a non-lilToon fade shader is explicitly converted and unrelated legacy texture slots are ignored', () => {
  const plan = materialPlan({...base, isLilToon: false, shaderName: 'arktoon/Fade',
    floats: {_UseOutline: 0, _UseDoubleSided: 1, _ShadowStrength: 0},
    textures: {_MainTex: map, _BumpMap: map, _1st_ShadeMap: map}})
  assert.equal(plan.native, false)
  assert.equal(plan.shaderVariant, 'Hidden/lilToonTransparent')
  assert.equal(plan.properties._UseBumpMap, 1)
  assert.equal(plan.properties._Cull, 0)
  assert.equal(plan.properties._UseShadow, 0)
  assert.deepEqual(Object.keys(plan.slots).sort(), ['_BumpMap', '_MainTex'])
})
