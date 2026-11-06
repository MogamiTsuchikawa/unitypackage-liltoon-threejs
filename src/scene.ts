import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { enableLilToon } from "@mochiya/three-liltoon";

export function createStudio(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const release = enableLilToon(renderer, { materialRenderQueue: true });
  renderer.domElement.setAttribute(
    "aria-label",
    "3D モデル表示領域。ドラッグで回転、スクロールでズーム",
  );
  renderer.domElement.tabIndex = 0;
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.015, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.autoRotateSpeed = 1.1;
  controls.minDistance = 0.15;
  controls.maxDistance = 20;
  const fill = new THREE.HemisphereLight(0xfff5e6, 0xaebbd1, 0.95);
  const key = new THREE.DirectionalLight(0xfff7ef, 1.1);
  key.position.set(-2, 4, 3);
  scene.add(fill, key);
  const grid = new THREE.GridHelper(24, 96, 0x69645d, 0x716e6a);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);
  const holder = new THREE.Group();
  scene.add(holder);
  let model: THREE.Object3D | null = null;
  let height = 1.8,
    width = 1.2,
    depth = 0.4;
  function setBackdrop(color: string) {
    scene.background = new THREE.Color(color);
    scene.fog = new THREE.FogExp2(scene.background, 0.16);
  }
  setBackdrop("#36383b");
  function home() {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance =
      (Math.max(height, width / camera.aspect) * 0.61) / Math.tan(halfFov) +
      depth / 2;
    controls.target.set(0, height / 2, 0);
    camera.position.set(0, height / 2 + distance * 0.038, distance);
    controls.update();
  }
  function resize() {
    const w = Math.max(host.clientWidth, 1),
      h = Math.max(host.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  resize();
  home();
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  let animate: ((delta: number) => void) | undefined;
  const clock = new THREE.Timer();
  clock.connect(document);
  renderer.setAnimationLoop((time) => {
    clock.update(time);
    const delta = Math.min(clock.getDelta(), 0.1);
    animate?.(delta);
    controls.update(delta);
    renderer.render(scene, camera);
  });
  function setModel(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0)
      throw new Error("表示できる形状がありません。");
    const scale = 1.8 / extent;
    const center = box.getCenter(new THREE.Vector3());
    if (model) holder.remove(model);
    model = root;
    holder.add(root);
    holder.scale.setScalar(scale);
    holder.position.set(
      -center.x * scale,
      -box.min.y * scale + 0.004,
      -center.z * scale,
    );
    height = size.y * scale;
    width = size.x * scale;
    depth = size.z * scale;
    home();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "r") home();
  };
  renderer.domElement.addEventListener("keydown", onKey);
  return {
    setModel,
    setAnimation(callback?: (delta: number) => void) {
      animate = callback;
    },
    home,
    setBackdrop,
    setLight(value: number) {
      key.intensity = value * 1.1;
      fill.intensity = value * 0.95;
    },
    setGrid(visible: boolean) {
      grid.visible = visible;
    },
    setSpin(enabled: boolean) {
      controls.autoRotate = enabled;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      clock.dispose();
      observer.disconnect();
      controls.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      release();
      renderer.dispose();
      renderer.domElement.removeEventListener("keydown", onKey);
      renderer.domElement.remove();
    },
  };
}
