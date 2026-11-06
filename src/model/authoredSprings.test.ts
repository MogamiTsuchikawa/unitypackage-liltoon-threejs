import test from "node:test";
import assert from "node:assert/strict";
import { Bone, Group } from "three";
import type { UnityAsset, UnityPackage } from "../unity";
import { readUnitySprings, readVrmSprings } from "./authoredSprings";

function unityAsset(guid: string, path: string, data = ""): UnityAsset {
  return {
    guid,
    path,
    name: path.split("/").at(-1)!,
    ext: path.slice(path.lastIndexOf(".")),
    meta: "",
    bytes: new TextEncoder().encode(data),
    globalScale: 1,
    subAssetNames: {},
    materialRemaps: {},
  };
}

test("recognize real SDK PhysBone components, match stripped FBX nodes by GUID/local ID, respect exclusions and referenced capsules", () => {
  const model = unityAsset("1".repeat(32), "Assets/robot.FBX");
  model.subAssetNames = {
    "4001": "Fringe",
    "4002": "Helmet",
    "4003": "Ignore",
  };
  const root = new Group(),
    hair = new Bone(),
    tip = new Bone(),
    ignore = new Bone(),
    helmet = new Bone();
  hair.name = "Fringe";
  tip.name = "Tip";
  helmet.name = "Helmet";
  ignore.name = "Ignore";
  root.add(hair, helmet);
  hair.add(tip, ignore);
  const lines = ["%YAML 1.1", "%TAG !u! tag:unity3d.com,2011:"];
  for (const [id, src, guid] of [
    ["101", "4001", model.guid],
    ["102", "4002", model.guid],
    ["103", "4003", model.guid],
    ["104", "4001", "b".repeat(32)],
  ]) {
    lines.push(
      "--- !u!4 &" + id + " stripped",
      "Transform:",
      "  m_CorrespondingSourceObject: {fileID: " +
        src +
        ", guid: " +
        guid +
        ", type: 3}",
    );
  }
  const sdk = "2a2c05204084d904aa4945ccff20d8e5";
  for (const [id, guid, transform] of [
    ["200", sdk, "101"],
    ["201", sdk, "104"],
    ["202", "a".repeat(32), "101"],
  ]) {
    lines.push(
      "--- !u!114 &" + id,
      "MonoBehaviour:",
      "  m_Enabled: 1",
      "  m_Script: {fileID: 1661641543, guid: " + guid + ", type: 3}",
      "  rootTransform: {fileID: " + transform + "}",
      "  ignoreTransforms:",
      "  - {fileID: 103}",
      "  pull: 0.8",
      "  gravity: 0.1",
      "  limitType: 1",
      "  maxAngleX: 50",
      "  colliders:",
      "  - {fileID: 300}",
    );
  }
  lines.push(
    "--- !u!114 &300",
    "MonoBehaviour:",
    "  m_Enabled: 1",
    "  m_Script: {fileID: -1631200402, guid: " + sdk + ", type: 3}",
    "  m_GameObject: {fileID: 102}",
    "  rootTransform: {fileID: 0}",
    "  shapeType: 1",
    "  radius: 0.1",
    "  height: 0.6",
    "  position: {x: 1, y: 2, z: 3}",
  );
  const scene = unityAsset(
    "2".repeat(32),
    "Assets/Avatar.unity",
    lines.join("\n"),
  );
  const pkg: UnityPackage = {
    assets: new Map([
      [model.guid, model],
      [scene.guid, scene],
    ]),
    models: [model],
    prefabs: [],
    materials: new Map(),
    warnings: [],
  };
  const warnings: string[] = [],
    springs = readUnitySprings(pkg, model, root, undefined, warnings);
  assert.deepEqual(warnings, []);
  assert.equal(springs.length, 1);
  assert.deepEqual(springs[0].joints, [hair, tip]);
  assert.equal(springs[0].pull, 0.8);
  assert.equal(springs[0].maxAngle, 50);
  assert.equal(springs[0].colliders[0].node, helmet);
  assert.deepEqual(springs[0].colliders[0].offset, [-1, 1.8, 3]);
  assert.deepEqual(springs[0].colliders[0].tail, [-1, 2.2, 3]);
});

test("VRM 1 honors explicit node order, per-joint stiffness, and scoped collider groups on unnamed nodes", () => {
  const base = new Bone(),
    mid = new Bone(),
    tip = new Bone(),
    other = new Bone();
  base.add(mid);
  mid.add(tip);
  const nodes = new Map([
    [0, base],
    [1, mid],
    [2, tip],
    [3, other],
  ]);
  const springs = readVrmSprings(
    {
      extensions: {
        VRMC_springBone: {
          springs: [
            {
              center: 0,
              joints: [
                { node: 0, stiffness: 1 },
                { node: 1, stiffness: 2 },
                { node: 2 },
              ],
              colliderGroups: [1],
            },
          ],
          colliders: [
            { node: 0, shape: { sphere: { radius: 4 } } },
            {
              node: 3,
              shape: {
                capsule: { offset: [1, 0, 0], tail: [1, 3, 0], radius: 0.1 },
              },
            },
          ],
          colliderGroups: [{ colliders: [0] }, { colliders: [1] }],
        },
      },
    },
    nodes,
  );
  assert.equal(springs.length, 1);
  assert.equal(springs[0].source, "VRM 1");
  assert.equal(springs[0].center, base);
  assert.deepEqual(springs[0].joints, [base, mid, tip]);
  assert.equal(springs[0].jointSettings?.get(mid)?.stiffness, 2 / 3);
  assert.equal(springs[0].colliders.length, 1);
  assert.deepEqual(springs[0].colliders[0].tail, [1, 3, 0]);
  assert.equal(springs[0].colliders[0].node, other);
});

test("VRM 0 expands only the authored subtree and converts legacy collider Z", () => {
  const root = new Bone(),
    tip = new Bone(),
    other = new Bone();
  root.add(tip);
  const springs = readVrmSprings(
    {
      extensions: {
        VRM: {
          secondaryAnimation: {
            boneGroups: [
              {
                bones: [0],
                stiffiness: 3,
                dragForce: 0.2,
                colliderGroups: [0],
              },
            ],
            colliderGroups: [
              {
                node: 2,
                colliders: [{ radius: 0.1, offset: { x: 2, y: 1, z: 3 } }],
              },
            ],
          },
        },
      },
    },
    new Map([
      [0, root],
      [1, tip],
      [2, other],
    ]),
  );
  assert.equal(springs.length, 1);
  assert.deepEqual(springs[0].joints, [root, tip]);
  assert.equal(springs[0].source, "VRM 0");
  assert.equal(springs[0].stiffness, 0.75);
  assert.deepEqual(springs[0].colliders[0].offset, [2, 1, -3]);
});
