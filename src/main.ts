import "./style.css";
import { buildUI } from "./ui";
import { bindMotionControls } from "./motion/controls";
import { createPlayer, type Player } from "./motion/player";
import { createStudio } from "./scene";
import { importPackage } from "./importPackage";
import { listModelChoices, loadModel } from "./model";
import type { UnityPackage } from "./unity";
import type { Mesh, Material } from "three";

buildUI();
const displayPlayer = bindMotionControls();
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const fileInput = el<HTMLInputElement>("file"),
  modelSelect = el<HTMLSelectElement>("model");
type Loaded = Awaited<ReturnType<typeof loadModel>>;
type Choice = ReturnType<typeof listModelChoices>[number];
let studio: ReturnType<typeof createStudio> | undefined;
let current:
  | {
      pkg: UnityPackage;
      choices: Choice[];
      selected: string;
      loaded: Loaded;
      player: Player;
    }
  | undefined;
let request = new AbortController();
const state = (msg: string, value = "") => {
  el("status").textContent = msg;
  el("status-dot").dataset.state = value;
};
function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  el("error-text").textContent = message;
  el("error").hidden = false;
  state("読み込みエラー", "error");
}
try {
  studio = createStudio(el("stage"));
} catch (error) {
  showError(
    new Error(
      "3D 表示を開始できません。WebGL 2 が使えるブラウザと GPU 設定を確認してください。",
    ),
  );
  console.error(error);
}
function busy(phase: string) {
  el("cover").hidden = false;
  el("welcome").hidden = true;
  el("loading").hidden = false;
  el("load-phase").textContent = phase;
  modelSelect.disabled = true;
  state(phase, "busy");
}
function finish() {
  el("loading").hidden = true;
  el("cover").hidden = !!current;
  el("welcome").hidden = !!current;
  modelSelect.disabled = !current || current.choices.length < 2;
  if (current) modelSelect.value = current.selected;
}
function materialInfo(loaded: Loaded) {
  const seen = new Set<Material>();
  loaded.root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (Array.isArray(mesh.material)) {
      for (const group of mesh.geometry.groups) {
        const mat = mesh.material[group.materialIndex ?? 0];
        if (group.count > 0 && mat) seen.add(mat);
      }
    } else seen.add(mesh.material);
  });
  const list = el("material-list");
  list.replaceChildren();
  for (const mat of seen) {
    const row = document.createElement("div"),
      name = document.createElement("span"),
      shader = document.createElement("small");
    row.className = "material-row";
    name.textContent = mat.name || "(no name)";
    const variant = String(mat.userData.sourceShader || "").replace(
      /^Hidden\/lilToon/,
      "",
    );
    shader.textContent =
      mat.userData.shaderSource === "lilToon"
        ? variant || "lilToon"
        : mat.userData.shaderSource === "converted" ||
            mat.userData.shaderSource === "fallback"
          ? "近似変換"
          : mat.type;
    row.title = mat.userData.sourceShader || mat.type;
    row.append(name, shader);
    list.append(row);
  }
  el("material-panel").hidden = !seen.size;
  el("material-caption").textContent =
    "マテリアル内訳 · lilToon " +
    loaded.stats.nativeMaterials +
    " / " +
    loaded.stats.materials;
}
function updateInspector(
  pkg: UnityPackage,
  loaded: Loaded,
  choices: Choice[],
  choice: Choice,
  file?: { name: string; size: number },
) {
  if (file) {
    el("file-name").textContent = file.name;
    el("file-name").title = file.name;
    el("file-info").textContent =
      (file.size / 1048576).toFixed(1) +
      " MiB  /  " +
      pkg.assets.size +
      " assets";
    modelSelect.replaceChildren(
      ...choices.map((c) => new Option(c.label, c.id)),
    );
  }
  modelSelect.value = choice.id;
  modelSelect.title = choice.path;
  for (const key of ["meshes", "materials", "triangles", "textures"] as const)
    el(key).textContent = loaded.stats[key].toLocaleString("en-US");
  materialInfo(loaded);
  const warnings = [...new Set([...pkg.warnings, ...loaded.warnings])];
  el("warning-count").textContent =
    "読み込み時の注意 (" + warnings.length + ")";
  el("warnings").replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement("li");
      li.textContent = w;
      return li;
    }),
  );
  el("warning-panel").hidden = !warnings.length;
  el<HTMLButtonElement>("home").disabled = false;
  el<HTMLButtonElement>("spin").disabled = false;
  state(choice.label + " を表示中", "ready");
}
function begin() {
  request.abort();
  request = new AbortController();
  el("error").hidden = true;
  if (!studio)
    throw new Error("WebGL 2 を初期化できないため、モデルを表示できません。");
  return request.signal;
}
async function renderChoice(
  pkg: UnityPackage,
  choices: Choice[],
  choice: Choice,
  signal: AbortSignal,
  file?: { name: string; size: number },
) {
  busy(choice.label + " のメッシュとマテリアルを準備中");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  signal.throwIfAborted();
  const loaded = await loadModel(pkg, choice);
  let player: Player;
  try {
    signal.throwIfAborted();
    studio!.setModel(loaded.root);
    player = createPlayer(loaded);
  } catch (e) {
    loaded.dispose();
    if (!signal.aborted && current) studio!.setModel(current.loaded.root);
    throw e;
  }
  const previous = current;
  current = { pkg, choices, selected: choice.id, loaded, player };
  studio!.setAnimation(player.update);
  previous?.player.dispose();
  previous?.loaded.dispose();
  displayPlayer(player);
  updateInspector(pkg, loaded, choices, choice, file);
}
async function openLocal(file?: File) {
  if (!file) return;
  const name = file.name;
  let signal: AbortSignal | undefined;
  try {
    signal = begin();
    if (!name.toLowerCase().endsWith(".unitypackage"))
      throw new Error(".unitypackage ファイルを選んでください。");
    busy(name + " を開いています");
    const pkg = await importPackage(file, signal, busy);
    signal.throwIfAborted();
    const choices = listModelChoices(pkg);
    if (!choices.length)
      throw new Error(
        "表示できるモデルがありません。FBX などのモデル本体を含むパッケージを選んでください。",
      );
    await renderChoice(pkg, choices, choices[0], signal, {
      name,
      size: file.size,
    });
  } catch (e) {
    if (!signal?.aborted) showError(e);
  } finally {
    if (!signal?.aborted) finish();
  }
}
fileInput.onchange = () => {
  void openLocal(fileInput.files?.[0]);
  fileInput.value = "";
};
document
  .querySelectorAll(".open")
  .forEach((button) =>
    button.addEventListener("click", () => fileInput.click()),
  );
modelSelect.onchange = async () => {
  if (!current) return;
  const { pkg, choices } = current;
  const choice = choices.find((c) => c.id === modelSelect.value);
  if (!choice) return;
  const signal = begin();
  try {
    await renderChoice(pkg, choices, choice, signal);
  } catch (e) {
    if (!signal.aborted) showError(e);
  } finally {
    if (!signal.aborted) finish();
  }
};
let drag = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    drag++;
    el("stage").classList.add("dragging");
  }
});
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
});
window.addEventListener("dragleave", () => {
  if (--drag <= 0) {
    drag = 0;
    el("stage").classList.remove("dragging");
  }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  drag = 0;
  el("stage").classList.remove("dragging");
  void openLocal(e.dataTransfer?.files[0]);
});
el("home").onclick = () => studio?.home();
el("spin").onclick = (e) => {
  const btn = e.currentTarget as HTMLButtonElement,
    on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", String(on));
  studio?.setSpin(on);
};
el("grid").onclick = (e) => {
  const btn = e.currentTarget as HTMLButtonElement,
    on = btn.getAttribute("aria-checked") !== "true";
  btn.setAttribute("aria-checked", String(on));
  studio?.setGrid(on);
};
el<HTMLInputElement>("light").oninput = (e) => {
  const value = Number((e.target as HTMLInputElement).value);
  studio?.setLight(value);
  el("light-value").textContent = value.toFixed(1) + "×";
};
document.querySelectorAll<HTMLButtonElement>(".swatch").forEach(
  (b) =>
    (b.onclick = () => {
      studio?.setBackdrop(b.dataset.color!);
      document.querySelectorAll(".swatch").forEach((s) => {
        s.classList.toggle("selected", s === b);
        s.setAttribute("aria-pressed", String(s === b));
      });
    }),
);
el("close-error").onclick = () => {
  el("error").hidden = true;
  if (current)
    state(
      current.choices.find((c) => c.id === current!.selected)!.label +
        " を表示中",
      "ready",
    );
  else state("ファイルを待機中");
};
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    request.abort();
    current?.player.dispose();
    current?.loaded.dispose();
    studio?.dispose();
  });
