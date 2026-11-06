import assert from "node:assert/strict";
import test from "node:test";
import {
  AnimationClip,
  Bone,
  Group,
  NumberKeyframeTrack,
  Vector3,
} from "three";
import { createMotionController } from "./animation";

function rig() {
  const root = new Group();
  root.rotation.y = 0.7;
  const add = (name: string, parent: Group | Bone, x: number, y: number) => {
    const b = new Bone();
    b.name = name;
    b.position.set(x, y, 0);
    parent.add(b);
    return b;
  };
  const hips = add("Hips", root, 0, 1),
    chest = add("Chest", hips, 0, 1);
  const head = add("Head", chest, 0, 0.5);
  const arms = (side: string, sign: number) => {
    const upper = add(side + "Arm", chest, 0.2 * sign, 0);
    add(side + "Arm", upper, 0, 0); // An FBX per-skin duplicate with no physical length.
    const lower = add(side + "ForeArm", upper, sign * 0.4, 0);
    return add(side + "Hand", lower, sign * 0.4, 0);
  };
  return { root, hips, head, left: arms("Left", 1), right: arms("Right", -1) };
}
const world = (b: Bone) => b.getWorldPosition(new Vector3());

test("idle lowers both hands, wave lifts the right hand, static restores the exact rotated bind pose", () => {
  const { root, left, right, head } = rig();
  const bind = [world(left), world(right)];
  const player = createMotionController(root);
  assert.equal(player.selected, "idle");
  assert.ok(
    world(left).y < bind[0].y - 0.6 && world(right).y < bind[1].y - 0.6,
  );
  const atRest = world(right);
  player.update(1.2);
  assert.ok(atRest.distanceTo(world(right)) > 0.01);
  player.select("wave");
  const waveStart = world(right);
  assert.ok(world(right).y > world(head).y - 0.1);
  player.update(0.4);
  assert.ok(waveStart.distanceTo(world(right)) > 0.04);
  for (let i = 0; i < 10; i++) {
    player.select("idle");
    player.update(2.6);
    player.select("wave");
    player.update(0.6);
  }
  player.select("static");
  assert.ok(
    bind[0].distanceTo(world(left)) < 1e-10 &&
      bind[1].distanceTo(world(right)) < 1e-10,
  );
  player.dispose();
});

test("choose a moving embedded body clip before presets, ignore morph-only clips and restore animated values", () => {
  const { root, hips } = rig();
  const moving = new AnimationClip("Bounce", 2, [
    new NumberKeyframeTrack("Hips.position[y]", [0, 1, 2], [1, 1.4, 1]),
  ]);
  const face = new AnimationClip("Face", 1, [
    new NumberKeyframeTrack(
      "Body.morphTargetInfluences[smile]",
      [0, 1],
      [0, 1],
    ),
  ]);
  root.animations = [face, moving];
  const player = createMotionController(root);
  assert.equal(player.choices.filter((c) => c.kind === "clip").length, 1);
  assert.equal(player.selected, "clip:" + moving.uuid);
  player.update(1);
  assert.ok(Math.abs(hips.position.y - 1.4) < 1e-5);
  player.select("idle");
  assert.equal(hips.position.y, 1);
  player.dispose();
});
