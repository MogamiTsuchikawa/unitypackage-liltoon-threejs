import { Bone, Object3D, Quaternion, Vector3 } from "three";
import type { UnityAsset, UnityPackage } from "../unity";
import { documents, fields, list, refGuid, refId, str } from "../unity/yaml";

type Vec = [number, number, number];
export interface AuthoredCollider {
  node: Object3D;
  offset: Vec;
  tail?: Vec;
  radius: number;
  inside: boolean;
}
export interface SpringForces {
  pull: number;
  spring: number;
  stiffness: number;
  gravity: number;
  gravityDir: Vec;
  radius: number;
  maxAngle: number;
}
export interface AuthoredSpring extends SpringForces {
  source: "PhysBone" | "DynamicBone" | "VRM 0" | "VRM 1";
  root: Object3D;
  joints: Object3D[];
  colliders: AuthoredCollider[];
  endOffset?: Vec;
  center?: Object3D;
  jointSettings?: Map<Object3D, SpringForces>;
}
const n = (v: unknown, fallback: number) =>
  (typeof v === "number" || (typeof v === "string" && v !== "")) &&
  Number.isFinite(+v)
    ? +v
    : fallback;
const clamp = (v: number) => Math.min(1, Math.max(0, v));
function xyz(v: unknown, fallback: Vec = [0, 0, 0]): Vec {
  if (Array.isArray(v))
    return [n(v[0], fallback[0]), n(v[1], fallback[1]), n(v[2], fallback[2])];
  const a = fields(v);
  return [n(a.x, fallback[0]), n(a.y, fallback[1]), n(a.z, fallback[2])];
}

function descendants(
  root: Object3D,
  allowed: (o: Object3D) => boolean,
): Object3D[] {
  const nodes: Object3D[] = [],
    stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    nodes.push(node);
    for (const c of node.children) if (allowed(c)) stack.push(c);
  }
  return nodes;
}

// Read Unity script data only for exact known serialized component types. Do
// not execute scripts or apply unrelated scenes to a similarly named skeleton.
function vrcKind(data: Record<string, unknown>) {
  const id = refId(data.m_Script),
    guid = refGuid(data.m_Script),
    identifier = str(data.m_EditorClassIdentifier).split("::").at(-1);
  if (
    identifier === "VRC.SDK3.Dynamics.PhysBone.Components.VRCPhysBone" ||
    (guid === "2a2c05204084d904aa4945ccff20d8e5" && id === "1661641543")
  )
    return "bone";
  if (
    identifier ===
      "VRC.SDK3.Dynamics.PhysBone.Components.VRCPhysBoneCollider" ||
    (guid === "2a2c05204084d904aa4945ccff20d8e5" && id === "-1631200402")
  )
    return "collider";
}

function springComponents(
  pkg: UnityPackage,
  asset: UnityAsset,
  model: UnityAsset,
  root: Object3D,
  directPrefab: boolean,
): AuthoredSpring[] {
  const docs = [...documents(asset, ["1", "4", "114"], true)];
  const objects = new Map(docs.map((d) => [d.id, d.data]));
  const byName = new Map<string, Object3D[]>();
  root.traverse((o) => {
    const name = String(o.userData.originalName ?? o.name);
    byName.set(name, [...(byName.get(name) ?? []), o]);
  });
  const nodeFor = (reference: unknown): Object3D | undefined => {
    let src = reference,
      name: string | undefined;
    if (!refGuid(src)) {
      const local = objects.get(refId(src));
      if (!local) return;
      src = local.m_CorrespondingSourceObject;
      // A full (unpacked) prefab exports local transforms without source links.
      // Only trust their names in the explicitly selected model's own prefab.
      if (!refGuid(src) && directPrefab)
        name =
          str(local.m_Name) ||
          str(objects.get(refId(local.m_GameObject))?.m_Name);
    }
    if (refGuid(src) === model.guid) name = model.subAssetNames[refId(src)];
    const options = name ? byName.get(name) : undefined;
    if (options?.length === 1) return options[0];
    // FBXLoader creates zero-length skeleton-binding copies with the same FBX
    // object ID. The original owns the transform, and all copies follow it.
    if (options?.length) {
      const ids = options.map((o) => (o as Object3D & { ID?: number }).ID);
      if (ids[0] !== undefined && ids.every((id) => id === ids[0]))
        return options.find((o) => !!o.userData.transformData);
    }
    return undefined;
  };
  const colliders = new Map<string, AuthoredCollider>();
  for (const { cls, data, id } of docs) {
    if (cls !== "114" || data.m_Enabled === "0" || vrcKind(data) !== "collider")
      continue;
    const node = nodeFor(
      refId(data.rootTransform) !== "0" && refId(data.rootTransform)
        ? data.rootTransform
        : data.m_GameObject,
    );
    const shape = n(data.shapeType, 0);
    if (!node || (shape !== 0 && shape !== 1)) continue; // Planes aren't approximated as giant spheres.
    const radius = Math.max(0, n(data.radius, 0)),
      half = shape === 1 ? Math.max(0, n(data.height, 0) * 0.5 - radius) : 0;
    const center = new Vector3(...xyz(data.position));
    center.x *= -1; // Unity's model-space basis is left-handed.
    const q = fields(data.rotation);
    const rot = new Quaternion(
      n(q.x, 0),
      -n(q.y, 0),
      -n(q.z, 0),
      n(q.w, 1),
    ).normalize();
    const axis = new Vector3(0, half, 0).applyQuaternion(rot);
    colliders.set(id, {
      node,
      radius,
      inside: data.insideBounds === "1",
      offset: center.clone().sub(axis).toArray(),
      ...(half > 0 ? { tail: center.add(axis).toArray() } : {}),
    });
  }
  const springs: AuthoredSpring[] = [];
  for (const { cls, data } of docs) {
    if (cls !== "114" || data.m_Enabled === "0") continue;
    const phys = vrcKind(data) === "bone";
    const script = pkg.assets.get(refGuid(data.m_Script));
    const dynamic =
      script?.name === "DynamicBone.cs" ||
      str(data.m_EditorClassIdentifier).split("::").at(-1) === "DynamicBone";
    if (!phys && !dynamic) continue;
    const ref = phys ? data.rootTransform : data.m_Root;
    const node = nodeFor(
      refId(ref) && refId(ref) !== "0" ? ref : data.m_GameObject,
    );
    if (!node) continue;
    const ignore = new Set(
      list(phys ? data.ignoreTransforms : data.m_Exclusions).map(nodeFor),
    );
    const joints = descendants(
      node,
      (o) =>
        !ignore.has(o) && (o instanceof Bone || (!!o.name && !("isMesh" in o))),
    );
    const offset = xyz(phys ? data.endpointPosition : data.m_EndOffset);
    offset[0] *= -1;
    if (joints.length === 1 && !offset.some(Boolean)) continue;
    const gravity = xyz(data.m_Gravity),
      magnitude = Math.hypot(...gravity);
    const vrcAngle = n(data.limitType, 0) ? n(data.maxAngleX, 90) : 180;
    springs.push({
      source: phys ? "PhysBone" : "DynamicBone",
      root: node,
      joints,
      endOffset: offset,
      pull: clamp(n(phys ? data.pull : data.m_Elasticity, 0.2)),
      spring: phys
        ? clamp(n(data.spring, 0.2))
        : 1 - clamp(n(data.m_Damping, 0.1)),
      stiffness: clamp(n(phys ? data.stiffness : data.m_Stiffness, 0.2)),
      gravity: phys ? n(data.gravity, 0) : magnitude,
      gravityDir:
        phys || !magnitude
          ? [0, -1, 0]
          : [
              -gravity[0] / magnitude,
              gravity[1] / magnitude,
              gravity[2] / magnitude,
            ],
      radius: Math.max(0, n(phys ? data.radius : data.m_Radius, 0)),
      maxAngle: Math.max(0, Math.min(180, vrcAngle)),
      colliders:
        data.allowCollision === "0"
          ? []
          : list(data.colliders)
              .map((r) => colliders.get(refId(r)))
              .filter((c): c is AuthoredCollider => !!c),
    });
  }
  return springs;
}

export function readUnitySprings(
  pkg: UnityPackage,
  model: UnityAsset,
  root: Object3D,
  prefabGuid: string | undefined,
  warnings: string[],
): AuthoredSpring[] {
  const assets = [...pkg.assets.values()]
    .filter((a) => a.guid === prefabGuid || a.ext === ".unity")
    .sort(
      (a, b) =>
        Number(b.guid === prefabGuid) - Number(a.guid === prefabGuid) ||
        a.path.localeCompare(b.path),
    );
  for (const asset of assets) {
    try {
      const springs = springComponents(
        pkg,
        asset,
        model,
        root,
        asset.guid === prefabGuid,
      );
      if (springs.length) return springs; // Don't merge competing configurations from different avatar variants.
    } catch (e) {
      warnings.push(
        asset.name +
          ": 揺れ設定を読み込めません (" +
          (e instanceof Error ? e.message.split("\n")[0] : "") +
          ")",
      );
    }
  }
  return [];
}

// VRMC_springBone 1.0 uses explicit ordered node indices. VRM 0.x stores a
// group of roots, with the same settings applied down each root's subtree.
export function readVrmSprings(
  json: unknown,
  nodes: Map<number, Object3D>,
): AuthoredSpring[] {
  const exts = fields(fields(json).extensions);
  const v1 = fields(exts.VRMC_springBone),
    v0 = fields(fields(exts.VRM).secondaryAnimation);
  const nodeFor = (i: unknown) =>
    typeof i === "number" ? nodes.get(i) : undefined;
  const getForces = (v: unknown, version: 0 | 1): SpringForces => {
    const data = fields(v);
    const s = Math.max(0, n(version ? data.stiffness : data.stiffiness, 1)),
      stiffness = s / (s + 1);
    return {
      stiffness,
      pull: stiffness,
      spring: 1 - clamp(n(data.dragForce, 0.4)),
      gravity: n(data.gravityPower, 0),
      gravityDir: xyz(data.gravityDir, [0, -1, 0]),
      radius: Math.max(0, n(data.hitRadius, 0)),
      maxAngle: 180,
    };
  };
  const springs: AuthoredSpring[] = [];
  if (list(v1.springs).length) {
    const shapes = list(v1.colliders).map((raw) => {
      const data = fields(raw),
        node = nodeFor(data.node),
        shape = fields(data.shape);
      if (!node || (!shape.sphere && !shape.capsule)) return;
      const c = fields(shape.sphere ?? shape.capsule);
      return {
        node,
        offset: xyz(c.offset),
        radius: Math.max(0, n(c.radius, 0)),
        inside: false,
        ...(shape.capsule ? { tail: xyz(c.tail) } : {}),
      } satisfies AuthoredCollider;
    });
    const groups = list(v1.colliderGroups).map((group) =>
      list(fields(group).colliders).flatMap((i) =>
        typeof i === "number" && shapes[i] ? [shapes[i]!] : [],
      ),
    );
    for (const raw of list(v1.springs)) {
      const spring = fields(raw),
        jointDefs = list(spring.joints);
      const joints = jointDefs.map((j) => nodeFor(fields(j).node));
      if (joints.length < 2 || !joints.every((j): j is Object3D => !!j))
        continue;
      const jointSettings = new Map(
        joints.map((j, i) => [j, getForces(jointDefs[i], 1)]),
      );
      springs.push({
        ...jointSettings.get(joints[0])!,
        jointSettings,
        source: "VRM 1",
        root: joints[0],
        joints,
        center: nodeFor(spring.center),
        colliders: list(spring.colliderGroups).flatMap((i) =>
          typeof i === "number" ? (groups[i] ?? []) : [],
        ),
      });
    }
  } else {
    const groups = list(v0.colliderGroups).map((group) => {
      const d = fields(group),
        node = nodeFor(d.node);
      if (!node) return [];
      return list(d.colliders).map((raw) => {
        const c = fields(raw),
          offset = xyz(c.offset);
        offset[2] *= -1; // VRM 0 secondary collider data is left-handed.
        return {
          node,
          offset,
          radius: Math.max(0, n(c.radius, 0)),
          inside: false,
        } satisfies AuthoredCollider;
      });
    });
    const gltfNodes = new Set(nodes.values());
    for (const raw of list(v0.boneGroups)) {
      const group = fields(raw),
        config = getForces(group, 0);
      for (const id of list(group.bones)) {
        const root = nodeFor(id);
        if (!root) continue;
        const joints = descendants(root, (o) => gltfNodes.has(o));
        if (joints.length < 2) continue;
        springs.push({
          ...config,
          source: "VRM 0",
          root,
          joints,
          center: nodeFor(group.center),
          colliders: list(group.colliderGroups).flatMap((i) =>
            typeof i === "number" ? (groups[i] ?? []) : [],
          ),
        });
      }
    }
  }
  return springs;
}
