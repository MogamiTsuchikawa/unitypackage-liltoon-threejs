import test from "node:test";
import assert from "node:assert/strict";
import { Bone, Group, MathUtils, Quaternion, Vector3 } from "three";
import type { AuthoredSpring } from "../model/authoredSprings";
import { createSpringMotion } from "./springs";

function rig() {
  const root = new Group(),
    head = new Bone(),
    hair = new Bone(),
    mid = new Bone(),
    tip = new Bone();
  root.add(head);
  head.add(hair);
  hair.add(mid);
  mid.add(tip);
  head.name = "Head";
  hair.name = "HairA";
  mid.name = "HairB";
  tip.name = "HairEnd";
  head.position.y = 1;
  hair.position.set(0.1, 0.1, 0);
  mid.position.y = tip.position.y = -0.12;
  const authored: AuthoredSpring = {
    source: "PhysBone",
    root: hair,
    joints: [hair, mid, tip],
    pull: 0.2,
    spring: 0.4,
    stiffness: 0.25,
    gravity: 0,
    gravityDir: [0, -1, 0],
    radius: 0,
    maxAngle: 12,
    colliders: [],
  };
  return { root, head, hair, mid, tip, authored };
}

test("authored accessory motion lags a moving head, preserves lengths and restores the animated pose exactly", () => {
  const { root, head, hair, mid, authored } = rig();
  const motion = createSpringMotion(root, { authored: [authored] });
  assert.equal(motion.source, "authored");
  assert.equal(motion.count, 2);
  for (let frame = 0; frame < 80; frame++) {
    motion.restore();
    head.rotation.y = Math.sin(frame * 0.05) * 0.5;
    hair.rotation.x = 0.05 * Math.sin(frame * 0.1); // stand-in for an animated rotation track
    const animated = hair.quaternion.clone();
    motion.update(1 / 60, 1);
    const offset = hair.quaternion.angleTo(animated);
    assert.ok(Number.isFinite(offset) && offset <= MathUtils.degToRad(12.001));
    assert.ok(
      Math.abs(
        hair
          .getWorldPosition(new Vector3())
          .distanceTo(mid.getWorldPosition(new Vector3())) - 0.12,
      ) < 1e-8,
    );
    if (frame === 20) assert.ok(offset > 0.01);
    motion.restore();
    assert.deepEqual(hair.quaternion.toArray(), animated.toArray());
  }
});

test("nudge affects only inferred accessory bones, safely resets after a tab pause and leaves no offsets when disabled", () => {
  const { root, head, hair } = rig();
  const motion = createSpringMotion(root);
  assert.equal(motion.source, "inferred");
  assert.equal(motion.count, 2);
  motion.update(1 / 60, 1);
  motion.nudge();
  for (let i = 0; i < 6; i++) motion.update(1 / 60, 1);
  assert.ok(hair.quaternion.angleTo(new Quaternion()) > MathUtils.degToRad(3));
  assert.deepEqual(head.quaternion.toArray(), [0, 0, 0, 1]);
  root.position.x = 100;
  motion.update(1, 1);
  assert.deepEqual(hair.quaternion.toArray(), [0, 0, 0, 1]);
  for (let i = 0; i < 600; i++) motion.update(1 / 60, 1);
  assert.ok(hair.quaternion.toArray().every(Number.isFinite));
  motion.update(1 / 60, 0);
  assert.deepEqual(hair.quaternion.toArray(), [0, 0, 0, 1]);
});

test("a locked VRM joint may inherit an authored center while neighboring joints remain simulated", () => {
  const { root, head, hair, mid, authored } = rig();
  const motion = createSpringMotion(root, {
    authored: [
      {
        ...authored,
        source: "VRM 1",
        center: head,
        jointSettings: new Map([[hair, { ...authored, maxAngle: 0 }]]),
      },
    ],
  });
  motion.update(1 / 60, 1);
  motion.nudge();
  head.position.x += 0.25;
  for (let i = 0; i < 4; i++) motion.update(1 / 60, 1);
  assert.ok(hair.quaternion.angleTo(new Quaternion()) < 1e-6);
  assert.ok(mid.quaternion.angleTo(new Quaternion()) > 0.02);
});

test("a capsule pushes a tip outside its radius without stretching the hair", () => {
  const { root, hair, mid, authored } = rig();
  const collider = new Group();
  root.add(collider);
  const rest = mid.getWorldPosition(new Vector3());
  collider.position.copy(rest).x -= 0.012;
  const motion = createSpringMotion(root, {
    authored: [
      {
        ...authored,
        maxAngle: 65,
        radius: 0.002,
        colliders: [
          {
            node: collider,
            offset: [0, -0.1, 0],
            tail: [0, 0.1, 0],
            radius: 0.032,
            inside: false,
          },
        ],
      },
    ],
  });
  motion.update(1 / 60, 1);
  const displaced = mid.getWorldPosition(new Vector3());
  assert.ok(displaced.x - collider.position.x >= 0.033);
  assert.ok(
    Math.abs(
      displaced.distanceTo(hair.getWorldPosition(new Vector3())) - 0.12,
    ) < 1e-8,
  );
});
