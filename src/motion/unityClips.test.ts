import test from "node:test";
import assert from "node:assert/strict";
import { Group, Mesh } from "three";
import { readClipAsset } from "../unity/clip";
import { readUnityClips } from "./unityClips";
import { createExpressions } from "./expressions";
import type { UnityAsset, UnityPackage } from "../unity";
const document = `--- !u!74 &7400000
AnimationClip:
  m_Name: smile
  m_AnimationClipSettings: {m_StopTime: 2}
  m_FloatCurves:
  - curve:
      m_Curve: [{time: 0, value: 0, outSlope: 0}, {time: 1, value: 100, inSlope: 0}]
    attribute: blendShape.smile
    path: Body
    classID: 137
  - curve: {m_Curve: [{time: 0, value: 0.7}]}
    attribute: RightHand.Thumb.1 Stretched
    path: ''
    classID: 95
`;
function setup() {
  const root = new Group(),
    mesh = new Mesh();
  mesh.name = "Body";
  mesh.morphTargetDictionary = { smile: 1 };
  mesh.morphTargetInfluences = [0.14, 0.23];
  root.add(mesh);
  const asset: UnityAsset = {
    guid: "a",
    path: "Assets/smile.anim",
    name: "smile.anim",
    ext: ".anim",
    globalScale: 1,
    materialRemaps: {},
    subAssetNames: {},
    meta: "",
    bytes: new TextEncoder().encode(document),
  };
  asset.clip = readClipAsset(asset);
  const pkg: UnityPackage = {
    assets: new Map([["a", asset]]),
    models: [],
    materials: new Map(),
    prefabs: [],
    warnings: [],
  };
  return { root, mesh, asset, pkg };
}
test("Unity .anim facial weights follow authored curves on the named mesh and layer over the body pose", () => {
  const { root, mesh, asset, pkg } = setup();
  const { clips, warnings } = readUnityClips(pkg, root, asset);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].tracks.length, 1);
  assert.equal(warnings.length, 1);
  const face = createExpressions(root, clips);
  face.select(clips[0].uuid);
  face.apply(0.25);
  assert.ok(Math.abs(mesh.morphTargetInfluences![1] - 0.15625) < 0.002); // Hermite, not a linear 0.25
  assert.equal(mesh.morphTargetInfluences![0], 0.14);
  face.restore();
  assert.equal(mesh.morphTargetInfluences![1], 0.23);
  mesh.morphTargetInfluences![1] = 0.61; // The body mixer changed this channel since the previous frame.
  face.apply(0.5);
  face.select("none");
  assert.equal(mesh.morphTargetInfluences![1], 0.61);
});
test("ambiguous Unity renderer paths do not drive either avatar", () => {
  const { root, mesh, asset, pkg } = setup();
  root.add(mesh.clone());
  assert.equal(readUnityClips(pkg, root, asset).clips.length, 0);
});
