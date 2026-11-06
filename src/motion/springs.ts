import { MathUtils, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { AuthoredSpring } from "../model/authoredSprings";

export type SpringMotionOptions = { authored?: readonly AuthoredSpring[] };
const accessory =
  /hair|ahoge|braid|ribbon|tail|tale|skirt|bangs|ear(?:end)?$|髪|リボン|尻尾|スカート|耳/i;
const joint = (o: Object3D) =>
  o.type === "Bone" || o.type === "Group" || o.type === "Object3D";
const clamp01 = (v: number) =>
  Number.isFinite(v) ? MathUtils.clamp(v, 0, 1) : 0;
const validOffset = (v: Vector3) =>
  Number.isFinite(v.lengthSq()) && v.lengthSq() > 1e-16;

type Segment = {
  node: Object3D;
  child?: Object3D;
  config?: AuthoredSpring;
  phase: number;
  position: Vector3;
  velocity: Vector3;
  anchor: Vector3;
  base: Quaternion;
  previousCenter: Matrix4;
  initialised: boolean;
  applied: boolean;
};

function collect(root: Object3D, authored: readonly AuthoredSpring[]) {
  const depthOrder: Object3D[] = [];
  root.traverse((node) => {
    if (joint(node)) depthOrder.push(node);
  });
  const segments = new Map<Object3D, Segment>();
  const add = (node: Object3D, child?: Object3D, config?: AuthoredSpring) => {
    if (segments.has(node) || segments.size >= 1024) return;
    segments.set(node, {
      node,
      child,
      config,
      phase: segments.size * 1.271,
      position: new Vector3(),
      velocity: new Vector3(),
      anchor: new Vector3(),
      base: new Quaternion(),
      previousCenter: new Matrix4(),
      initialised: false,
      applied: false,
    });
  };
  for (const config of authored) {
    const nodes = new Set(config.joints);
    for (const node of nodes) {
      const children = node.children.filter(
        (c) => nodes.has(c) && validOffset(c.position),
      );
      // One parent has one rotation. Only simulate unambiguous segments on branches;
      // their child strands still simulate independently.
      if (children.length === 1) add(node, children[0], config);
      else if (
        !children.length &&
        !node.children.some((c) => nodes.has(c)) &&
        config.endOffset &&
        validOffset(new Vector3().fromArray(config.endOffset))
      )
        add(node, undefined, config);
    }
  }
  const matchedAuthored = segments.size > 0;
  if (!matchedAuthored)
    for (const node of depthOrder) {
      if (node.type !== "Bone" || !accessory.test(node.name)) continue;
      const children = node.children.filter(
        (c) => joint(c) && validOffset(c.position),
      );
      if (children.length === 1) add(node, children[0]);
    }
  return {
    segments: depthOrder
      .map((n) => segments.get(n))
      .filter((s): s is Segment => !!s),
    source: matchedAuthored
      ? ("authored" as const)
      : segments.size
        ? ("inferred" as const)
        : ("none" as const),
  };
}

/**
 * Inertial tail particles anchored to animated bones, solved in world space. Does not
 * modify bone translations or own an animation clock. restore() before applying the
 * next animation pose; update() after animation. reset() for discontinuities/seeks.
 */
export function createSpringMotion(
  root: Object3D,
  options: SpringMotionOptions = {},
) {
  const { segments, source } = collect(root, options.authored ?? []);
  // Scratch space is shared by segments; there are no per-frame math object allocations.
  const origin = new Vector3(),
    goal = new Vector3(),
    axis = new Vector3(),
    direction = new Vector3();
  const force = new Vector3(),
    gravity = new Vector3(),
    delta = new Vector3();
  const ca = new Vector3(),
    cb = new Vector3(),
    line = new Vector3(),
    close = new Vector3();
  const inverse = new Matrix4(),
    centerDelta = new Matrix4(),
    frame = new Quaternion(),
    addition = new Quaternion(),
    identity = new Quaternion();
  const localGoal = new Vector3(),
    localMoved = new Vector3(),
    scale = new Vector3(),
    meter = new Vector3();
  let time = 0,
    impulse = 0,
    nextSide = 1;

  function restore() {
    for (const s of segments)
      if (s.applied) {
        s.node.quaternion.copy(s.base);
        s.applied = false;
      }
  }
  function reset() {
    restore();
    for (const s of segments) {
      s.initialised = false;
      s.velocity.set(0, 0, 0);
    }
    impulse = 0;
    time = 0;
  }

  // Preserve the animated rest direction as the cone axis and project the tip
  // onto a sphere about its moving joint. Even sharp turns preserve segment length.
  function constrain(s: Segment, length: number, limit: number) {
    direction.subVectors(s.position, origin);
    if (!validOffset(direction)) direction.copy(axis);
    else direction.normalize();
    const cos = MathUtils.clamp(direction.dot(axis), -1, 1);
    if (cos < Math.cos(limit)) {
      delta.copy(direction).addScaledVector(axis, -cos);
      if (!validOffset(delta)) direction.copy(axis);
      else
        direction
          .copy(axis)
          .multiplyScalar(Math.cos(limit))
          .addScaledVector(delta.normalize(), Math.sin(limit));
    }
    s.position.copy(origin).addScaledVector(direction, length);
  }

  function collide(s: Segment, meterScale: number, hitRadius: number) {
    if (!s.config) return;
    for (const collider of s.config.colliders) {
      collider.node.getWorldQuaternion(frame);
      collider.node.getWorldPosition(cb);
      ca.fromArray(collider.offset)
        .applyQuaternion(frame)
        .multiplyScalar(meterScale)
        .add(cb);
      if (collider.tail) {
        cb.add(
          line
            .fromArray(collider.tail)
            .applyQuaternion(frame)
            .multiplyScalar(meterScale),
        );
        line.subVectors(cb, ca);
        const t = MathUtils.clamp(
          close.subVectors(s.position, ca).dot(line) / (line.lengthSq() || 1),
          0,
          1,
        );
        ca.addScaledVector(line, t);
      }
      close.subVectors(s.position, ca);
      const radius = Math.max(
        0,
        (collider.radius + (collider.inside ? -1 : 1) * hitRadius) * meterScale,
      );
      if (
        collider.inside
          ? close.lengthSq() <= radius * radius
          : close.lengthSq() >= radius * radius
      )
        continue;
      if (!validOffset(close)) close.copy(axis);
      s.position.copy(ca).addScaledVector(close.normalize(), radius);
    }
  }
  function update(dt: number, amount: number) {
    const blend = clamp01(amount);
    if (!blend || !Number.isFinite(dt) || dt < 0 || dt > 0.3) {
      reset();
      return;
    }
    // restore() is also idempotent for callers without a mixer.
    restore();
    root.updateWorldMatrix(true, true);
    root.parent?.getWorldScale(meter);
    const wrapperScale = root.parent ? Math.max(1e-8, Math.abs(meter.y)) : 1;
    const elapsed = Math.min(dt, 0.075);
    const steps = Math.max(1, Math.ceil(elapsed * 100)),
      h = elapsed / steps;
    time += elapsed;
    for (const s of segments) {
      const { node, child, config } = s;
      s.base.copy(node.quaternion);
      node.updateWorldMatrix(true, false);
      origin.setFromMatrixPosition(node.matrixWorld);
      const meterScale = config?.source.startsWith("VRM")
        ? Math.abs(root.getWorldScale(scale).y)
        : wrapperScale;
      if (child) goal.copy(child.position).applyMatrix4(node.matrixWorld);
      else {
        node.getWorldQuaternion(frame);
        goal
          .fromArray(config!.endOffset!)
          .applyQuaternion(frame)
          .multiplyScalar(meterScale)
          .add(origin);
      }
      axis.subVectors(goal, origin);
      const length = axis.length();
      if (!Number.isFinite(length) || length < 1e-8) continue;
      axis.multiplyScalar(1 / length);
      if (config?.center) {
        // VRM centers define an inertial reference frame: moving the center as a
        // whole should carry its particles, without applying fictitious velocity.
        config.center.updateWorldMatrix(true, false);
        if (s.initialised) {
          centerDelta
            .copy(s.previousCenter)
            .invert()
            .premultiply(config.center.matrixWorld);
          s.position.applyMatrix4(centerDelta);
          s.anchor.applyMatrix4(centerDelta);
          const speed = s.velocity.length();
          if (speed > 0)
            s.velocity.transformDirection(centerDelta).multiplyScalar(speed);
        }
        s.previousCenter.copy(config.center.matrixWorld);
      }
      if (!s.initialised || s.anchor.distanceTo(origin) > length * 4) {
        s.position.copy(goal);
        s.velocity.set(0, 0, 0);
        s.initialised = true;
      }
      s.anchor.copy(origin);
      const profile = config?.jointSettings?.get(node) ?? config;
      const pull = clamp01(profile?.pull ?? 0.3),
        stiff = clamp01(profile?.stiffness ?? 0.22);
      const bounce = clamp01(profile?.spring ?? 0.38);
      const frequency = 7 + pull * 13 + stiff * 7;
      const damping = 2 * frequency * (0.85 - bounce * 0.54);
      const limit = MathUtils.degToRad(
        MathUtils.clamp(profile?.maxAngle ?? 32, 0, 85),
      );
      if (profile)
        gravity
          .fromArray(profile.gravityDir)
          .normalize()
          .multiplyScalar(MathUtils.clamp(profile.gravity, -1, 1));
      else gravity.set(0, -0.14, 0);

      // A faint shared breeze makes an otherwise static idle pose breathe. Length-relative
      // acceleration behaves consistently on short bangs and long tails, at any viewer scale.
      force.copy(gravity).multiplyScalar(length * frequency ** 2 * 0.45);
      force.x += Math.sin(time * 1.7 + 0.28 * Math.sin(s.phase)) * length * 2.6;
      force.z += Math.sin(time * 1.13 + s.phase * 0.04) * length * 0.8;
      if (impulse) s.velocity.x += impulse * length * 6.5;
      for (let i = 0; i < steps; i++) {
        delta
          .subVectors(goal, s.position)
          .multiplyScalar(frequency ** 2)
          .add(force);
        s.velocity
          .addScaledVector(delta, h)
          .multiplyScalar(Math.exp(-damping * h));
        s.position.addScaledVector(s.velocity, h);
        constrain(s, length, limit);
        if (config?.colliders.length) {
          collide(s, meterScale, profile?.radius ?? 0);
          constrain(s, length, limit);
        }
        // Remove radial velocity so constraints cannot accumulate hidden energy.
        s.velocity.addScaledVector(direction, -s.velocity.dot(direction));
      }
      // Apply one local rotation relative to THIS frame's animated base. World-space
      // inertia is retained across frames, but the animated base is never accumulated.
      inverse.copy(node.matrixWorld).invert();
      localGoal.copy(goal).applyMatrix4(inverse).normalize();
      localMoved.copy(s.position).applyMatrix4(inverse).normalize();
      if (!validOffset(localGoal) || !validOffset(localMoved)) continue;
      addition.setFromUnitVectors(localGoal, localMoved);
      node.quaternion
        .copy(s.base)
        .multiply(identity.identity().slerp(addition, blend))
        .normalize();
      s.applied = true;
    }
    impulse = 0;
  }
  return {
    source,
    sources: [
      ...new Set(
        segments
          .map((s) => s.config?.source)
          .filter((s): s is AuthoredSpring["source"] => !!s),
      ),
    ],
    count: segments.length,
    update,
    restore,
    reset,
    nudge() {
      impulse = nextSide;
      nextSide = -nextSide;
    },
  };
}
