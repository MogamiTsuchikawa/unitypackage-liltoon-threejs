import { icon } from "../ui";
import type { Player } from "./player";

export function bindMotionControls() {
  const select = (id: string) =>
    document.getElementById(id) as HTMLSelectElement;
  const button = (id: string) =>
    document.getElementById(id) as HTMLButtonElement;
  const motion = select("motion"),
    expression = select("expression"),
    speed = select("speed");
  const toggle = button("play-motion"),
    nudge = button("nudge"),
    strength = document.getElementById("spring") as HTMLInputElement;
  let player: Player | undefined;
  function sync() {
    if (!player) return;
    const hasPlayback =
      motion.length > 1 || expression.length > 1 || player.springs.count > 0;
    motion.disabled = motion.length < 2;
    expression.disabled = expression.length < 2;
    speed.disabled = toggle.disabled = !hasPlayback;
    strength.disabled = player.springs.count === 0;
    nudge.disabled =
      !player.playing || !player.springs.count || !player.strength;
    const playing = player.playing && hasPlayback;
    const badge = document.getElementById("motion-badge")!;
    badge.textContent = hasPlayback
      ? playing
        ? "PLAYING"
        : "PAUSED"
      : "STILL";
    badge.classList.toggle("active", playing);
    toggle.innerHTML = icon(playing ? "pause" : "play");
    const label = playing ? "一時停止" : "再生";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    document.getElementById("spring-value")!.textContent =
      Math.round(player.strength * 100) + "%";
  }
  motion.onchange = () => {
    player?.selectBody(motion.value);
    sync();
  };
  expression.onchange = () => player?.selectFace(expression.value);
  toggle.onclick = () => {
    if (player) player.play(!player.playing);
    sync();
  };
  strength.oninput = () => {
    player?.setStrength(Number(strength.value) / 100);
    sync();
  };
  speed.onchange = () => player?.setSpeed(Number(speed.value));
  nudge.onclick = () => player?.nudge();
  return (value: Player) => {
    player = value;
    motion.replaceChildren();
    for (const [type, label] of [
      ["static", "ポーズ"],
      ["clip", "モデル内クリップ"],
      ["preset", "ビューアのモーション"],
    ]) {
      const group = document.createElement("optgroup");
      group.label = label;
      for (const c of player.body.choices.filter((c) => c.kind === type))
        group.append(new Option(c.label, c.id));
      if (group.children.length) motion.append(group);
    }
    motion.value = player.body.selected;
    expression.replaceChildren(
      ...player.face.choices.map((c) => new Option(c.label, c.id)),
    );
    expression.value = player.face.selected;
    strength.value = String(player.strength * 100);
    speed.value = String(player.speed);
    const s = player.springs;
    document.getElementById("spring-source")!.textContent =
      s.count === 0
        ? "対象ボーンなし"
        : (s.source === "authored"
            ? s.sources.join(" / ")
            : "ボーン名から推定") +
          " · " +
          s.count +
          " 関節";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      player.play(false);
    sync();
  };
}
