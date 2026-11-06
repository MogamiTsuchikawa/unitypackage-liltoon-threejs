// Extract small, transferable curve lists in the archive worker; the full Unity
// documents also contain duplicated editor curves and Humanoid muscle bindings.
import type { UnityAsset } from "./types";
import { documents, fields, list, str, num } from "./yaml";
export interface UnityCurve {
  path: string;
  property: "shape" | "position" | "quaternion" | "scale";
  shape?: string;
  times: number[];
  values: number[];
}
export interface UnityClip {
  name: string;
  duration: number;
  humanoid: boolean;
  curves: UnityCurve[];
}
const number = (v: unknown) => num(v, NaN);
export function readClipAsset(asset: UnityAsset): UnityClip {
  const doc = documents(asset, ["74"]).next();
  if (doc.done) throw new Error("AnimationClip がありません");
  const d = doc.value.data,
    curves: UnityCurve[] = [];
  const settings = fields(d.m_AnimationClipSettings);
  let duration = Math.max(0, num(settings.m_StopTime, 0));
  let sampleBudget = 0;
  function curve(
    entry: unknown,
    property: UnityCurve["property"],
    shape?: string,
  ) {
    const e = fields(entry),
      c: UnityCurve = {
        path: str(e.path),
        property,
        shape,
        times: [],
        values: [],
      };
    const axes =
      property === "quaternion" ? ["x", "y", "z", "w"] : ["x", "y", "z"];
    let previous: { time: number; value: number; out: number } | undefined;
    for (const frame of list(fields(e.curve).m_Curve)) {
      const k = fields(frame),
        time = number(k.time);
      const values =
        property === "shape"
          ? [number(k.value) / 100]
          : axes.map((a) => number(fields(k.value)[a]));
      if (
        time < 0 ||
        !Number.isFinite(time) ||
        values.some((n) => !Number.isFinite(n))
      )
        continue;
      if (c.times.length && time <= c.times[c.times.length - 1]) continue;
      // Unity stores blendshape weights as percentages and unweighted tangent
      // slopes as units/second. Sample Hermite segments before sending to Three.
      if (property === "shape") {
        const incoming = num(k.inSlope, 0) / 100,
          next = values[0];
        if (previous && (previous.value !== next || previous.out || incoming)) {
          const span = time - previous.time;
          const steps = Math.min(600, Math.ceil(span * 30));
          const hold =
            /inf/i.test(String(k.inSlope)) || previous.out === Infinity;
          if (hold) {
            if (span > 1e-4) {
              c.times.push(time - 1e-5);
              c.values.push(previous.value);
            }
          } else
            for (let i = 1; i < steps; i++) {
              const t = i / steps,
                u = 1 - t;
              c.times.push(previous.time + t * span);
              c.values.push(
                u * u * (1 + 2 * t) * previous.value +
                  span * u * u * t * previous.out +
                  t * t * (3 - 2 * t) * next -
                  span * t * t * u * incoming,
              );
            }
          sampleBudget += steps;
          if (sampleBudget > 500000)
            throw new Error("アニメーションのキー数が多すぎます");
        }
        previous = {
          time,
          value: next,
          out: /inf/i.test(String(k.outSlope))
            ? Infinity
            : num(k.outSlope, 0) / 100,
        };
      }
      c.times.push(time);
      c.values.push(...values);
      duration = Math.max(duration, time);
    }
    if (c.times.length) curves.push(c);
  }
  let humanoid = false;
  for (const f of list(d.m_FloatCurves)) {
    const row = fields(f),
      attr = str(row.attribute);
    if (attr.startsWith("blendShape.")) curve(f, "shape", attr.slice(11));
    if (str(row.classID) === "95") humanoid = true;
  }
  for (const [key, prop] of [
    ["m_PositionCurves", "position"],
    ["m_RotationCurves", "quaternion"],
    ["m_ScaleCurves", "scale"],
  ] as const) {
    for (const f of list(d[key])) curve(f, prop);
  }
  return {
    name: str(d.m_Name) || asset.name.replace(/\.anim$/i, ""),
    duration: Math.max(duration, 1 / 60),
    humanoid,
    curves,
  };
}
