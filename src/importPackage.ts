import type { UnityPackage } from "./unity";
export function importPackage(
  file: Blob,
  signal: AbortSignal,
  progress: (phase: string) => void,
) {
  return new Promise<UnityPackage>((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || "パッケージを解析できませんでした。"));
    };
    worker.onmessage = ({ data }) => {
      if (data.phase) {
        progress(data.phase);
        return;
      }
      finish();
      if (data.pkg) resolve(data.pkg);
      else
        reject(new Error(data.error || "パッケージを解析できませんでした。"));
    };
    worker.postMessage(file);
  });
}
