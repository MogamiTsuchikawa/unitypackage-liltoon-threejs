import {
  AnimationClip,
  PropertyBinding,
  type KeyframeTrack,
  type Interpolant,
  type Object3D,
  type Mesh,
} from "three";

export const isFaceClip = (clip: AnimationClip) =>
  clip.tracks.length > 0 &&
  clip.tracks.every((t) => t.name.includes(".morphTargetInfluences"));
type Binding = {
  weights: number[];
  index: number;
  original: number[];
  sample(t: number): ArrayLike<number>;
};
export function createExpressions(
  root: Object3D,
  clips: readonly AnimationClip[],
) {
  const choices = [{ id: "none", label: "モデルのまま" }],
    sets = new Map<string, { bindings: Binding[]; duration: number }>();
  let current: Binding[] = [],
    duration = 1,
    elapsed = 0,
    selected = "none",
    applied = false;
  // Only offer automatic blinking when an unambiguous blink morph exists.
  // Prefer the bilateral shape, so left and right shapes aren't applied twice.
  const lids: Binding[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) return;
    const names = Object.entries(mesh.morphTargetDictionary);
    const bilateral = names.find(([name]) =>
      /^(?:eye[_ -]?)?blink2?$|^まばたき$/i.test(name),
    );
    const split = names.filter(([name]) =>
      /^(?:eye[_ -]?)?blink2?[_ -]?(?:left|right|l|r)$/i.test(name),
    );
    for (const [, index] of bilateral ? [bilateral] : split) {
      const value = [0];
      lids.push({
        weights: mesh.morphTargetInfluences,
        index,
        original: [0],
        sample(t) {
          // Quick close, gentler opening; two unequal intervals per loop.
          const a = t < 4.65 ? t - 3.2 : t - 7.9;
          const phase = Math.max(
            0,
            Math.min(1, a <= 0.09 ? a / 0.09 : (0.26 - a) / 0.17),
          );
          value[0] = phase * phase * (3 - 2 * phase);
          return value;
        },
      });
    }
  });
  if (lids.length) {
    sets.set("blink", { bindings: lids, duration: 8.7 });
    choices.push({ id: "blink", label: "自動まばたき" });
  }
  for (const clip of clips.filter(isFaceClip)) {
    const bindings: Binding[] = [];
    for (const track of clip.tracks) {
      const path = PropertyBinding.parseTrackName(track.name);
      const obj = PropertyBinding.findNode(root, path.nodeName) as Mesh | null;
      const weights = obj?.morphTargetInfluences;
      if (!weights) continue;
      const index =
        path.propertyIndex === undefined
          ? 0
          : (obj?.morphTargetDictionary?.[path.propertyIndex] ??
            Number(path.propertyIndex));
      // Three assigns createInterpolant at runtime (also for glTF cubic splines).
      const sampler = (
        track as KeyframeTrack & { createInterpolant(): Interpolant }
      ).createInterpolant();
      const width = path.propertyIndex !== undefined ? 1 : weights.length;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index + width > weights.length
      )
        continue;
      bindings.push({
        weights,
        index,
        original: new Array(width).fill(0),
        sample: (t) => sampler.evaluate(t),
      });
    }
    if (bindings.length) {
      sets.set(clip.uuid, {
        bindings,
        duration: Math.max(clip.duration, 1 / 60),
      });
      choices.push({ id: clip.uuid, label: clip.name });
    }
  }
  // Restore only the channels we overrode. An embedded body clip can animate
  // face weights itself, so capture its fresh result before applying the overlay.
  function restore() {
    if (!applied) return;
    for (const b of current)
      for (let i = 0; i < b.original.length; i++)
        b.weights[b.index + i] = b.original[i];
    applied = false;
  }
  function apply(delta: number) {
    restore();
    elapsed = (elapsed + delta) % duration;
    for (const b of current) {
      const result = b.sample(elapsed);
      for (let i = 0; i < b.original.length; i++) {
        b.original[i] = b.weights[b.index + i];
        if (Number.isFinite(result[i])) b.weights[b.index + i] = result[i];
      }
    }
    applied = true;
  }
  return {
    choices,
    get selected() {
      return selected;
    },
    restore,
    apply,
    select(id: string) {
      restore();
      const s = sets.get(id);
      current = s?.bindings ?? [];
      duration = s?.duration ?? 1;
      elapsed = 0;
      selected = s ? id : "none";
      apply(0);
    },
  };
}
