import type { DaedalusVm, ZenKit } from "@kolarz3/zenkit";
import { createVm, loadDaedalusScript } from "./vm-manager";

export type CameraModeDef = Readonly<{
  bestRange: number;
  minRange: number;
  maxRange: number;
  bestElevation: number;
  minElevation: number;
  maxElevation: number;
  bestAzimuth: number;
  minAzimuth: number;
  maxAzimuth: number;
  bestRotZ: number;
  minRotZ: number;
  maxRotZ: number;
  rotOffsetX: number;
  rotOffsetY: number;
  rotOffsetZ: number;
  targetOffsetX: number;
  targetOffsetY: number;
  targetOffsetZ: number;
  veloTrans: number;
  veloRot: number;
  translate: number;
  rotate: number;
  collision: number;
}>;

const CAMERA_MODE_FLOATS: ReadonlyArray<readonly [keyof CameraModeDef, string]> = [
  ["bestRange", "CCAMSYS.BESTRANGE"],
  ["minRange", "CCAMSYS.MINRANGE"],
  ["maxRange", "CCAMSYS.MAXRANGE"],
  ["bestElevation", "CCAMSYS.BESTELEVATION"],
  ["minElevation", "CCAMSYS.MINELEVATION"],
  ["maxElevation", "CCAMSYS.MAXELEVATION"],
  ["bestAzimuth", "CCAMSYS.BESTAZIMUTH"],
  ["minAzimuth", "CCAMSYS.MINAZIMUTH"],
  ["maxAzimuth", "CCAMSYS.MAXAZIMUTH"],
  ["bestRotZ", "CCAMSYS.BESTROTZ"],
  ["minRotZ", "CCAMSYS.MINROTZ"],
  ["maxRotZ", "CCAMSYS.MAXROTZ"],
  ["rotOffsetX", "CCAMSYS.ROTOFFSETX"],
  ["rotOffsetY", "CCAMSYS.ROTOFFSETY"],
  ["rotOffsetZ", "CCAMSYS.ROTOFFSETZ"],
  ["targetOffsetX", "CCAMSYS.TARGETOFFSETX"],
  ["targetOffsetY", "CCAMSYS.TARGETOFFSETY"],
  ["targetOffsetZ", "CCAMSYS.TARGETOFFSETZ"],
  ["veloTrans", "CCAMSYS.VELOTRANS"],
  ["veloRot", "CCAMSYS.VELOROT"],
] as const;

const CAMERA_MODE_INTS: ReadonlyArray<readonly [keyof CameraModeDef, string]> = [
  ["translate", "CCAMSYS.TRANSLATE"],
  ["rotate", "CCAMSYS.ROTATE"],
  ["collision", "CCAMSYS.COLLISION"],
] as const;

export function readCameraModeDef(
  vm: Pick<DaedalusVm, "getSymbolFloat" | "getSymbolInt">,
  instanceName: string,
): CameraModeDef | null {
  const bestRange = vm.getSymbolFloat("CCAMSYS.BESTRANGE", instanceName);
  if (!Number.isFinite(bestRange) || bestRange <= 0) return null;

  const out: any = {};
  for (const [key, symbolName] of CAMERA_MODE_FLOATS) {
    out[key] = vm.getSymbolFloat(symbolName, instanceName);
  }
  for (const [key, symbolName] of CAMERA_MODE_INTS) {
    out[key] = vm.getSymbolInt(symbolName, instanceName);
  }
  return out as CameraModeDef;
}

export function discoverCameraModeInstanceNames(
  vm: Pick<DaedalusVm, "symbolCount" | "getSymbolNameByIndex">,
): string[] {
  const count = Number(vm.symbolCount);
  if (!Number.isFinite(count) || count <= 0) return [];

  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = vm.getSymbolNameByIndex(i);
    if (!r?.success) continue;
    const name = String(r.data ?? "");
    if (!name.startsWith("CAMMOD")) continue;
    names.push(name);
  }
  return names;
}

export function discoverCameraModeInstances(
  vm: Pick<DaedalusVm, "symbolCount" | "getSymbolNameByIndex">,
): Array<{ name: string; symbolIndex: number }> {
  const count = Number(vm.symbolCount);
  if (!Number.isFinite(count) || count <= 0) return [];

  const out: Array<{ name: string; symbolIndex: number }> = [];
  for (let i = 0; i < count; i++) {
    const r = vm.getSymbolNameByIndex(i);
    if (!r?.success) continue;
    const name = String(r.data ?? "");
    if (!name.startsWith("CAMMOD")) continue;
    out.push({ name, symbolIndex: i });
  }
  return out;
}

export function extractCameraModes(
  vm: Pick<
    DaedalusVm,
    | "symbolCount"
    | "getSymbolNameByIndex"
    | "getSymbolFloat"
    | "getSymbolInt"
    | "initInstanceByIndex"
  >,
): Record<string, CameraModeDef> {
  const out: Record<string, CameraModeDef> = {};
  for (const { name, symbolIndex } of discoverCameraModeInstances(vm)) {
    // CAMERA.DAT is loaded in its own VM. To read instance member values, the VM must
    // create/initialize the instance first.
    try {
      vm.initInstanceByIndex(symbolIndex);
    } catch {
      // Best-effort; if the VM can't init it, `readCameraModeDef` will return null.
    }
    const def = readCameraModeDef(vm, name);
    if (def) out[name] = def;
  }
  return out;
}

let cameraModesCache: Record<string, CameraModeDef> | null = null;
let cameraModesPromise: Promise<Record<string, CameraModeDef>> | null = null;

export function getCameraModes(): Record<string, CameraModeDef> | null {
  return cameraModesCache;
}

export function getCameraMode(name: string): CameraModeDef | null {
  return cameraModesCache?.[name] ?? null;
}

export async function loadCameraModes(
  zenKit: ZenKit,
  scriptPath: string = "/SCRIPTS/_COMPILED/CAMERA.DAT",
): Promise<Record<string, CameraModeDef>> {
  if (cameraModesCache) return cameraModesCache;
  if (cameraModesPromise) return cameraModesPromise;

  cameraModesPromise = (async () => {
    try {
      const { script } = await loadDaedalusScript(zenKit, scriptPath);
      const vm = createVm(zenKit, script);
      const modes = extractCameraModes(vm);
      cameraModesCache = modes;
      if (!Object.keys(modes).length) {
        console.warn(
          "[Camera.dat] Loaded but found 0 CAMMOD* instances; camera will use fallbacks.",
        );
      }
      return modes;
    } catch (e) {
      // Allow retries after transient failures.
      cameraModesPromise = null;
      cameraModesCache = null;
      throw e;
    }
  })();

  return cameraModesPromise;
}
