import type { UnityAsset, UnityPackage, UnityPrefab } from '../unity';

export interface ModelChoice {
  id: string;
  label: string;
  path: string;
  model: UnityAsset;
  prefab?: UnityPrefab;
}

const basename = (file: string) => file.split('/').at(-1)!.replace(/\.[^.]+$/, '');
const example = (path: string) => /\/(examples?|samples?|demos?)(\/|~\/)/i.test(path);

/** Offer raw assets as well, even when a prefab references the same geometry. */
export function listModelChoices(pkg: UnityPackage): ModelChoice[] {
  const choices: ModelChoice[] = [];
  for (const model of pkg.models) {
    for (const prefab of pkg.prefabs.filter(p => p.modelGuids.includes(model.guid))) {
      const suffix = prefab.modelGuids.length > 1 ? ` / ${basename(model.name)}` : '';
      choices.push({ id: `${prefab.guid}:${model.guid}`, label: basename(prefab.path) + suffix, path: prefab.path, model, prefab });
    }
    choices.push({ id: model.guid, label: basename(model.name), path: model.path, model });
  }
  const rank = (c: ModelChoice) =>
    (example(c.model.path) || example(c.path) ? -100 : 0) +
    (c.prefab ? 20 : 0) +
    (/\b(standard|default|base)\b/i.test(c.label.replaceAll('_', ' ')) ? 5 : 0) +
    (c.prefab && c.label.toLowerCase() === basename(c.model.name).toLowerCase() ? 6 : 0);
  return choices.sort((a, b) => rank(b) - rank(a) || b.model.bytes.length - a.model.bytes.length || a.path.localeCompare(b.path));
}
