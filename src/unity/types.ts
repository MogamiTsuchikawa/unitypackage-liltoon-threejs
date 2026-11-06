import type { ArchiveAsset } from './archive.ts';

export interface UnityAsset extends ArchiveAsset {
  clip?: import('./clip').UnityClip;
  name: string;
  ext: string;
  globalScale: number;
  materialRemaps: Record<string, string>;
  subAssetNames: Record<string, string>;
}
export interface UnityTexture { guid: string; scale: { x: number; y: number }; offset: { x: number; y: number } }
export interface UnityColor { r: number; g: number; b: number; a: number }
export interface UnityMaterial {
  guid: string; path: string; name: string; shaderGuid: string; shaderName: string; isLilToon: boolean;
  floats: Record<string, number>;
  colors: Record<string, UnityColor>;
  textures: Record<string, UnityTexture>;
  renderQueue: number;
}
export interface UnityRenderer {
  modelGuid: string; meshName: string; objectName: string; materialGuids: string[]; enabled: boolean;
}
export interface UnityPrefab {
  guid: string; name: string; path: string; modelGuids: string[]; renderers: UnityRenderer[];
}
export interface UnityPackage {
  assets: Map<string, UnityAsset>; models: UnityAsset[]; materials: Map<string, UnityMaterial>;
  prefabs: UnityPrefab[]; warnings: string[];
}
