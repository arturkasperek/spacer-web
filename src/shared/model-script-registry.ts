import type { ModelScript, ZenKit } from "@kolarz3/zenkit";

export type NpcAnimationScriptState = {
  baseScript: string;
  overlays: string[];
};

export type AnimationMeta = {
  name: string;
  layer: number;
  next: string | null;
  blendIn: number;
  blendOut: number;
  flags: number;
  /**
   * The compiled animation base name (i.e. the `.MSB` key used for `.MAN` lookup).
   * Example: `HUMANS` or `HUMANS_RELAXED`.
   *
   * Note: MDS/MSB also stores a "source model" (often `.ASC`) for an animation, but our runtime
   * loads `.MAN` from `/ANIMS/_COMPILED/${model}-${ani}.MAN`, which uses the MSB key, not the ASC name.
   */
  model: string;
  firstFrame: number;
  lastFrame: number;
  fps: number;
  speed: number;
};

export function normalizeMdsToScriptKey(inputName: string): string {
  const raw = (inputName || "").trim();
  if (!raw) return "";
  const lastSlash = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  const base = (lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw).trim();
  const withoutExt = base.replace(/\.(MDS|MSB)$/i, "");
  return withoutExt.trim().toUpperCase();
}

export function modelScriptKeyToCompiledPath(scriptKey: string): string {
  const key = (scriptKey || "").trim().toUpperCase();
  return `/ANIMS/_COMPILED/${key}.MSB`;
}

type LoadedScript = {
  key: string;
  script: ModelScript;
  animationsByName: Map<string, AnimationMeta>;
};

export class ModelScriptRegistry {
  private readonly zenKit: ZenKit;
  private readonly fetchBinary: (url: string) => Promise<Uint8Array>;
  private readonly loaded = new Map<string, LoadedScript>();
  private readonly loading = new Map<string, Promise<LoadedScript | null>>();

  constructor(params: { zenKit: ZenKit; fetchBinary?: (url: string) => Promise<Uint8Array> }) {
    this.zenKit = params.zenKit;
    this.fetchBinary =
      params.fetchBinary ??
      (async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      });
  }

  getLoadedScript(key: string): LoadedScript | null {
    const k = (key || "").trim().toUpperCase();
    return this.loaded.get(k) ?? null;
  }

  /**
   * Checks whether animation exists in already loaded script metadata.
   * - `true`: animation exists for this model key
   * - `false`: script is loaded and animation is missing
   * - `null`: script isn't loaded yet (unknown)
   */
  hasAnimation(modelKey: string, animationName: string): boolean | null {
    const k = (modelKey || "").trim().toUpperCase();
    const nameKey = (animationName || "").trim().toUpperCase();
    if (!k || !nameKey) return null;
    const loaded = this.loaded.get(k);
    if (!loaded) return null;
    return loaded.animationsByName.has(nameKey);
  }

  startLoadScript(key: string): void {
    void this.loadScript(key);
  }

  async loadScript(key: string): Promise<LoadedScript | null> {
    const k = (key || "").trim().toUpperCase();
    if (!k) return null;
    const already = this.loaded.get(k);
    if (already) return already;

    const pending = this.loading.get(k);
    if (pending) return pending;

    const p = (async () => {
      try {
        const path = modelScriptKeyToCompiledPath(k);
        const bytes = await this.fetchBinary(path);
        const script = this.zenKit.createModelScript();
        const res = script.loadFromArray(bytes);
        if (!res?.success) return null;

        const count = script.getAnimationCount ? script.getAnimationCount() : 0;
        const animationsByName = new Map<string, AnimationMeta>();
        for (let i = 0; i < count; i++) {
          const name = script.getAnimationName(i) || "";
          const keyName = name.trim().toUpperCase();
          if (!keyName) continue;
          const next = (script.getAnimationNext(i) || "").trim();
          const meta: AnimationMeta = {
            name: name.trim(),
            layer: script.getAnimationLayer(i) ?? 0,
            next: next ? next : null,
            blendIn: script.getAnimationBlendIn(i) ?? 0,
            blendOut: script.getAnimationBlendOut(i) ?? 0,
            flags: script.getAnimationFlags(i) ?? 0,
            model: k,
            firstFrame: script.getAnimationFirstFrame(i) ?? 0,
            lastFrame: script.getAnimationLastFrame(i) ?? 0,
            fps: script.getAnimationFps(i) ?? 25,
            speed: script.getAnimationSpeed(i) ?? 1,
          };
          animationsByName.set(keyName, meta);
        }

        const loaded: LoadedScript = { key: k, script, animationsByName };
        this.loaded.set(k, loaded);
        return loaded;
      } finally {
        this.loading.delete(k);
      }
    })();

    this.loading.set(k, p);
    return p;
  }

  /**
   * Resolves animation metadata for an NPC using its base model script + overlays.
   * Returns `null` if metadata isn't loaded yet (but kicks off async loads for relevant scripts).
   */
  getAnimationMetaForNpc(
    npcScripts: NpcAnimationScriptState | null | undefined,
    animationName: string,
  ): AnimationMeta | null {
    const nameKey = (animationName || "").trim().toUpperCase();
    if (!nameKey) return null;

    const st: NpcAnimationScriptState = npcScripts ?? { baseScript: "HUMANS", overlays: [] };
    const keys = [...(st.overlays || [])].map((s) => s.toUpperCase());
    keys.push((st.baseScript || "HUMANS").toUpperCase());

    // Resolve from the most recently applied overlay, falling back to base.
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const loaded = this.loaded.get(k);
      if (!loaded) {
        this.startLoadScript(k);
        continue;
      }
      const meta = loaded.animationsByName.get(nameKey);
      if (meta) return meta;
    }

    return null;
  }
}
