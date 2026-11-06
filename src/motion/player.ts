import type { LoadedModel } from "../model";
import { createMotionController } from "./animation";
import { createSpringMotion } from "./springs";
import { createExpressions } from "./expressions";

export function createPlayer(model: LoadedModel) {
  // Construct after the viewer has scaled and positioned the model.
  const springs = createSpringMotion(model.root, { authored: model.springs });
  const body = createMotionController(model.root, model.clips);
  const face = createExpressions(model.root, model.clips);
  if (body.selected === "idle" && face.choices.some((c) => c.id === "blink"))
    face.select("blink");
  let playing = true,
    strength = 1,
    speed = 1;
  const refresh = () => {
    body.update(0);
    face.apply(0);
  };
  return {
    body,
    face,
    springs,
    get playing() {
      return playing;
    },
    get strength() {
      return strength;
    },
    get speed() {
      return speed;
    },
    play(on: boolean) {
      playing = on;
    },
    setSpeed(value: number) {
      speed = Math.max(0.25, Math.min(2, value));
    },
    setStrength(value: number) {
      strength = Math.max(0, Math.min(1, value));
      if (!strength) springs.reset();
    },
    selectBody(id: string) {
      springs.reset();
      face.restore();
      body.select(id);
      refresh();
    },
    selectFace(id: string) {
      face.select(id);
    },
    nudge() {
      if (playing && strength) springs.nudge();
    },
    update(dt: number) {
      if (!playing || !Number.isFinite(dt) || dt <= 0) return;
      const step = Math.min(dt, 0.1) * speed;
      springs.restore();
      face.restore();
      body.update(step);
      face.apply(step);
      springs.update(step, strength);
    },
    dispose() {
      springs.reset();
      face.restore();
      body.dispose();
    },
  };
}
export type Player = ReturnType<typeof createPlayer>;
