import { LoadingManager } from 'three';
import { resolveAssetPath, type UnityAsset, type UnityPackage } from '../unity';

// White, opaque PNG. Some FBXs reference obsolete textures on the author's
// machine even though their Unity importer remaps every material to a .mat.
const NO_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

export class ModelResources {
  readonly manager = new LoadingManager();
  readonly missing = new Set<string>();
  private urls = new Map<string, string>();
  private embedded = new Set<string>();
  private ready: Promise<void>;

  constructor(pkg: UnityPackage, model: UnityAsset) {
    this.ready = new Promise(resolve => { this.manager.onLoad = resolve; });
    this.manager.itemStart('model-parse');
    this.manager.setURLModifier(uri => {
      if (/^data:/i.test(uri)) return uri;
      if (/^blob:/i.test(uri)) {
        this.embedded.add(uri); // FBXLoader creates these for embedded binary images.
        return uri;
      }
      const asset = resolveAssetPath(pkg, model.path, uri);
      if (asset) {
        let url = this.urls.get(asset.guid);
        if (!url) {
          const mime: Record<string, string> = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.bmp':'image/bmp' };
          url = URL.createObjectURL(new Blob([asset.bytes], { type: mime[asset.ext] ?? 'application/octet-stream' }));
          this.urls.set(asset.guid, url);
        }
        return url;
      }
      // Never issue requests for external URLs or filesystem paths from an imported model.
      this.missing.add(uri.split(/[\\/]/).pop() || 'unnamed');
      // A glTF buffer URI may have any extension (or none). Feeding substitute
      // image bytes to its accessor could create silent geometry corruption.
      if (['.gltf', '.glb', '.vrm'].includes(model.ext)) throw new Error(`モデルが参照するデータがありません: ${uri}`);
      return NO_IMAGE;
    });
  }

  async finish(parsed: boolean) {
    this.manager.itemEnd('model-parse');
    // FBXLoader returns immediately while its image reads continue. On a failed
    // parse, no caller needs those images and no pending loader may hold up the error.
    if (parsed) await this.ready;
    else this.manager.abort();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    for (const url of this.embedded) URL.revokeObjectURL(url);
    this.urls.clear();
    this.embedded.clear();
  }
}
