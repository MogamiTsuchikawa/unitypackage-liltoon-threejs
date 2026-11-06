import {
  AnimationClip,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Mesh,
  Object3D,
  Vector3,
  Quaternion,
  type KeyframeTrack,
} from "three";
import type { UnityAsset, UnityPackage } from "../unity";

export function readUnityClips(
  pkg: UnityPackage,
  root: Object3D,
  _model: UnityAsset,
) {
  const clips: AnimationClip[] = [],
    warnings: string[] = [];
  const paths = new Map<string, Object3D | null>();
  root.updateWorldMatrix(true, true);
  root.traverse((obj) => {
    let path = "";
    for (
      let node: Object3D | null = obj;
      node && node !== root;
      node = node.parent
    ) {
      const name = node.userData.originalName || node.name;
      if (!name) break;
      path = path ? name + "/" + path : name;
      // Map suffix paths; ambiguous names never pick an arbitrary mesh.
      paths.set(path, paths.has(path) ? null : obj);
    }
  });
  let skippedMuscles = false;
  for (const a of pkg.assets.values()) {
    const clip = a.clip;
    if (!clip) continue;
    const tracks: KeyframeTrack[] = [];
    for (const c of clip.curves) {
      const obj = c.path ? paths.get(c.path) : root;
      if (!obj) continue;
      if (c.property === "shape") {
        const mesh = obj as Mesh;
        const i = mesh.morphTargetDictionary?.[c.shape!];
        if (!mesh.isMesh || i == null || !mesh.morphTargetInfluences) continue;
        tracks.push(
          new NumberKeyframeTrack(
            obj.uuid + ".morphTargetInfluences[" + i + "]",
            c.times,
            c.values,
          ),
        );
      } else {
        // Mecanim uses an Avatar to retarget its muscle space; generic auxiliary
        // tracks are not a substitute for its body pose. Don't offer a false idle.
        if (clip.humanoid) continue;
        const path = obj.uuid + "." + c.property,
          v = c.values.slice();
        if (c.property === "quaternion") {
          const q = new Quaternion(),
            last = new Quaternion();
          for (let i = 0; i < v.length; i += 4) {
            q.fromArray(v, i);
            q.set(q.x, -q.y, -q.z, q.w).normalize();
            if (i && q.dot(last) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
            q.toArray(v, i);
            last.copy(q);
          }
          tracks.push(new QuaternionKeyframeTrack(path, c.times, v));
        } else {
          if (c.property === "position") {
            const s =
              obj.parent?.getWorldScale(new Vector3()) ?? new Vector3(1, 1, 1);
            if (Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) < 1e-8)
              continue;
            for (let i = 0; i < v.length; i += 3) {
              v[i] /= -s.x;
              v[i + 1] /= s.y;
              v[i + 2] /= s.z;
            }
          }
          tracks.push(new VectorKeyframeTrack(path, c.times, v));
        }
      }
    }
    if (clip.humanoid) skippedMuscles = true;
    if (tracks.length)
      clips.push(new AnimationClip(clip.name, clip.duration, tracks));
  }
  if (skippedMuscles)
    warnings.push(
      "Unity Humanoid の筋肉・IK カーブは対象外です。対応する表情カーブは「表情」から再生できます。",
    );
  return { clips, warnings };
}
