import {
  AnimationClip,
  AnimationMixer,
  Bone,
  MathUtils,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

export interface MotionChoice {
  id: string;
  label: string;
  kind: "static" | "preset" | "clip";
  duration?: number;
}

const normalized = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");
const childOf = (child: Object3D, ancestor: Object3D) => {
  for (let p = child.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
};

function findHumanoid(root: Object3D) {
  const bones: Bone[] = [];
  // FBXLoader duplicates some bones in zero-length child chains when multiple
  // meshes use the same armature. Move the outer bone once, so every skin follows.
  root.traverse((p) => {
    if (p instanceof Bone) bones.push(p);
  });
  function find(aliases: string[], under?: Bone) {
    return bones.find(
      (p) =>
        (!under || childOf(p, under)) &&
        aliases.some((s) => normalized(p.name).endsWith(s)),
    );
  }
  const hips = find(["hips", "pelvis"]);
  const chest =
    find(["upperchest", "chest", "spine2", "spine1"], hips) ||
    find(["spine"], hips);
  const head = find(["head"], chest || hips);
  if (!head || !hips) return;
  function arm(side: "left" | "right") {
    const s = side[0];
    const upper = find(
      [
        side + "upperarm",
        side + "arm",
        s + "upperarm",
        "upperarm" + s,
        "uparm" + s,
      ],
      chest || hips,
    );
    if (!upper) return;
    const elbow = find(
      [
        side + "forearm",
        side + "lowerarm",
        s + "forearm",
        s + "lowerarm",
        "forearm" + s,
        "lowerarm" + s,
      ],
      upper,
    );
    if (!elbow) return;
    const hand = find(
      [side + "hand", s + "hand", "hand" + s, side + "wrist", "wrist" + s],
      elbow,
    );
    return hand && { upper, elbow, hand };
  }
  const left = arm("left"),
    right = arm("right");
  if (!left || !right) return;
  root.updateWorldMatrix(true, true);
  const tmp = new Vector3();
  const side = left.upper
    .getWorldPosition(new Vector3())
    .sub(right.upper.getWorldPosition(tmp));
  const up = head
    .getWorldPosition(new Vector3())
    .sub(hips.getWorldPosition(tmp))
    .normalize();
  side.addScaledVector(up, -side.dot(up)).normalize(); // +X towards avatar's left shoulder.
  const forward = new Vector3().crossVectors(side, up).normalize();
  if (!forward.lengthSq()) return;
  // Store axes relative to the model, so rotating its parent still rotates the pose.
  const inv = root.getWorldQuaternion(new Quaternion()).invert();
  for (const axis of [up, side, forward]) axis.applyQuaternion(inv);
  const joints = [
    head,
    chest,
    left.upper,
    left.elbow,
    left.hand,
    right.upper,
    right.elbow,
    right.hand,
  ].filter((b): b is Bone => !!b);
  const original = new Map(joints.map((b) => [b, b.quaternion.clone()]));
  return { head, chest, left, right, side, up, forward, original };
}

// A swinging offset in world space is conjugated into the parent's basis;
// this works with FBX bone prerotations and arbitrary local bone axes.
function presetPlayer(root: Object3D) {
  const rig = findHumanoid(root);
  if (!rig) return;
  const parent = new Quaternion(),
    inv = new Quaternion(),
    swing = new Quaternion(),
    modelQ = new Quaternion();
  const start = new Vector3(),
    current = new Vector3(),
    desired = new Vector3();
  const up = new Vector3(),
    side = new Vector3(),
    front = new Vector3();
  function rotateWorld(bone: Bone) {
    bone.parent!.getWorldQuaternion(parent);
    inv.copy(parent).invert().multiply(swing).multiply(parent);
    bone.quaternion.premultiply(inv).normalize();
  }
  function tilt(bone: Bone | undefined, axis: Vector3, degrees: number) {
    if (!bone) return;
    swing.setFromAxisAngle(axis, MathUtils.degToRad(degrees));
    rotateWorld(bone);
  }
  function aim(bone: Bone, child: Bone, x: number, y: number, z: number) {
    child.getWorldPosition(current).sub(bone.getWorldPosition(start));
    if (current.lengthSq() < 1e-14) return;
    desired
      .copy(side)
      .multiplyScalar(x)
      .addScaledVector(up, y)
      .addScaledVector(front, z)
      .normalize();
    swing.setFromUnitVectors(current.normalize(), desired);
    rotateWorld(bone);
  }
  function reset() {
    for (const [b, q] of rig!.original) b.quaternion.copy(q);
  }
  return {
    reset,
    pose(mode: "idle" | "wave", phase: number) {
      reset();
      root.getWorldQuaternion(modelQ);
      side.copy(rig.side).applyQuaternion(modelQ);
      up.copy(rig.up).applyQuaternion(modelQ);
      front.copy(rig.forward).applyQuaternion(modelQ);
      const breathing = Math.sin(phase * 2),
        sway = Math.sin(phase);
      tilt(rig.chest, side, -1.4 + breathing * 2.1);
      tilt(rig.chest, front, sway * 2);
      tilt(rig.head, up, sway * 6);
      tilt(rig.head, front, -2 + Math.sin(phase + 0.8) * 2);
      tilt(rig.head, side, breathing * 1.6);
      for (const [arm, sign] of [
        [rig.left, 1],
        [rig.right, -1],
      ] as const) {
        if (mode === "wave" && sign === -1) {
          const wave = Math.sin(phase * 3);
          aim(arm.upper, arm.elbow, sign * 0.86, 0.15 + sway * 0.07, 0.28);
          aim(arm.elbow, arm.hand, sign * (0.13 + wave * 0.4), 1, 0.22);
          tilt(arm.hand, front, 9 + wave * 18);
        } else {
          aim(
            arm.upper,
            arm.elbow,
            sign * (0.37 + breathing * 0.045),
            -1,
            0.09 + sway * 0.05,
          );
          aim(
            arm.elbow,
            arm.hand,
            sign * (0.12 - breathing * 0.025),
            -1,
            0.24 + breathing * 0.08,
          );
        }
      }
    },
  };
}

function varyingTransforms(clip: AnimationClip) {
  return clip.tracks.some((track) => {
    if (
      !/\.(?:position|quaternion|rotation|scale)(?:\[|$)/i.test(track.name) ||
      /(?:tail|tale|hair|skirt|ribbon|jiggle|breast|ear)[^./]*\./i.test(
        track.name,
      )
    )
      return false;
    const width = track.getValueSize();
    for (let i = width; i < track.values.length; i++) {
      if (Math.abs(track.values[i] - track.values[i % width]) > 1e-4)
        return true;
    }
    return false;
  });
}

/** Own the model's body pose. Expression-only clips are handled by the facial controls. */
export function createMotionController(
  root: Object3D,
  supplied?: readonly AnimationClip[],
) {
  const presets = presetPlayer(root);
  const clips = new Set<AnimationClip>(supplied);
  if (!supplied)
    root.traverse((p) => p.animations.forEach((c) => clips.add(c)));
  const sources = new Map<string, AnimationClip>();
  const choices: MotionChoice[] = [
    { id: "static", label: "元のポーズ", kind: "static" },
  ];
  if (presets)
    choices.push(
      { id: "idle", label: "待機", kind: "preset", duration: 5.6 },
      { id: "wave", label: "手を振る", kind: "preset", duration: 4.8 },
    );
  for (const c of clips) {
    if (
      !c.tracks.length ||
      !Number.isFinite(c.duration) ||
      c.duration <= 0 ||
      c.tracks.every((t) => t.name.includes("morphTargetInfluences"))
    )
      continue;
    const id = "clip:" + c.uuid;
    sources.set(id, c);
    choices.push({
      id,
      label: c.name || "モデル内モーション " + sources.size,
      kind: "clip",
      duration: c.duration,
    });
  }
  const mixer = new AnimationMixer(root);
  let selected = "static",
    time = 0,
    duration = 0;
  function update(deltaSeconds: number) {
    if (selected === "static") return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    time = (time + delta) % duration;
    if (selected === "idle" || selected === "wave")
      presets?.pose(selected, (time * 2 * Math.PI) / duration);
    else mixer.update(delta);
  }
  function select(id: string) {
    const choice = choices.find((c) => c.id === id);
    if (!choice)
      throw new Error("指定されたモーションはこのモデルにありません。");
    mixer.stopAllAction();
    presets?.reset();
    selected = id;
    time = 0;
    duration = choice.duration ?? 0;
    const clip = sources.get(id);
    if (clip) mixer.clipAction(clip).reset().play();
    update(0);
  }
  const firstUseful = [...sources].find(
    ([, c]) =>
      varyingTransforms(c) &&
      !/(?:^|[ _-])(?:[at][ _-]?pose|bind[ _-]?pose|rest[ _-]?pose)(?:$|[ _-])/i.test(
        c.name,
      ),
  );
  select(firstUseful?.[0] ?? (presets ? "idle" : "static"));
  return {
    choices,
    get selected() {
      return selected;
    },
    get time() {
      return time;
    },
    select,
    update,
    dispose() {
      select("static");
      mixer.uncacheRoot(root);
    },
  };
}
