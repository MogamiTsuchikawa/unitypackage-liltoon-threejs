import { loadUnityPackage } from "./unity";
self.onmessage = async ({ data }: MessageEvent<Blob>) => {
  try {
    const pkg = await loadUnityPackage(data, (phase) =>
      self.postMessage({ phase }),
    );
    const buffers = [
      ...new Set([...pkg.assets.values()].map((a) => a.bytes.buffer)),
    ];
    self.postMessage({ pkg }, { transfer: buffers });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
