import { useRef, useEffect, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import {
  getMeshPath,
  getModelPath,
  getMorphMeshPath,
  getVobType,
  getVobTypeName,
  shouldUseHelperVisual,
} from "./vob-utils";
import { VOBBoundingBox } from "./vob-bounding-box";
import { loadMeshCached, buildThreeJSGeometryAndMaterials } from "../shared/mesh-utils";
import {
  createStreamingState,
  shouldUpdateStreaming,
  getItemsToLoadUnload,
  disposeObject3D,
} from "../world/distance-streaming";
import type { World, ZenKit, Vob, ProcessedMeshData, Model, MorphMesh } from "@kolarz3/zenkit";
import { getRuntimeVm } from "../vm-manager";
import type { SpawnedItemData } from "../shared/types";

interface VobData {
  id: string;
  vob: Vob;
  position: THREE.Vector3;
  visualName: string;
  vobType?: number; // VOB type (e.g., 11 for zCVobSpot)
}

type RenderQueue = "opaque" | "alphaTest" | "transparent";
type TransparentPass = "alphaBlend" | "additive";
const RENDER_QUEUE_ORDER: Record<RenderQueue, number> = {
  opaque: 1000,
  alphaTest: 1500,
  transparent: 2000,
};
const TRANSPARENT_PASS_ORDER: Record<TransparentPass, number> = {
  alphaBlend: RENDER_QUEUE_ORDER.transparent,
  additive: 3000,
};

// VOB Renderer Component - loads and renders Virtual Object Bases (VOBs)
function VOBRenderer({
  world,
  zenKit,
  cameraPosition,
  onLoadingStatus,
  onVobStats,
  selectedVob,
  onSelectedVobBoundingBox,
  showVobSpots = true,
  showLights = true,
  dynamicItems = [],
}: Readonly<{
  world: World | null;
  zenKit: ZenKit | null;
  cameraPosition?: THREE.Vector3;
  onLoadingStatus: (status: string) => void;
  onVobStats?: (stats: {
    loaded: number;
    total: number;
    queue: number;
    loading: number;
    meshCache: number;
    morphCache: number;
    textureCache: number;
  }) => void;
  selectedVob?: Vob | null;
  onSelectedVobBoundingBox?: (center: THREE.Vector3, size: THREE.Vector3) => void;
  showVobSpots?: boolean;
  showLights?: boolean;
  dynamicItems?: SpawnedItemData[];
}>) {
  const { scene } = useThree();
  const { world: rapierWorld, rapier } = useRapier();
  const hasLoadedRef = useRef(false);

  // VOB management state
  const loadedVOBsRef = useRef(new Map<string, THREE.Object3D>()); // vob id -> THREE.Mesh/Object3D
  const allVOBsRef = useRef<VobData[]>([]); // All VOB data from world
  const VOB_LOAD_DISTANCE = 5000; // Load VOBs within this distance
  const VOB_UNLOAD_DISTANCE = 6000; // Unload VOBs beyond this distance

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

  // Asset caches to avoid reloading
  const meshCacheRef = useRef(new Map<string, ProcessedMeshData>()); // path -> processed mesh data
  const textureCacheRef = useRef(new Map<string, THREE.DataTexture>()); // path -> THREE.DataTexture
  const materialCacheRef = useRef(new Map<string, THREE.Material>()); // texture path -> THREE.Material
  const modelCacheRef = useRef(new Map<string, Model>()); // path -> ZenKit Model instance
  const morphMeshCacheRef = useRef(
    new Map<string, { morphMesh: MorphMesh; processed: ProcessedMeshData; animations: string[] }>(),
  ); // path -> { morphMesh, processed, animations }
  const itemVisualCacheRef = useRef(new Map<string, string>());
  const vmSymbolIndexCacheRef = useRef(new Map<string, number | null>());

  // Streaming loader state
  const vobLoadQueueRef = useRef<VobData[]>([]);
  const loadingVOBsRef = useRef(new Set<string>()); // Track currently loading VOBs
  const MAX_CONCURRENT_LOADS = 15; // Load up to 15 VOBs concurrently
  const vobColliderHandlesRef = useRef(new Map<string, number>());
  const consumedDynamicItemSignaturesRef = useRef(new Set<string>());
  const ITEM_VOB_TYPE = 2; // oCItem

  const findWaypointPosition = (
    worldObj: World,
    name: string,
  ): { x: number; y: number; z: number } | null => {
    const key = (name || "").trim().toUpperCase();
    if (!key) return null;
    try {
      const waypoints = (worldObj as any).getAllWaypoints?.();
      if (
        !waypoints ||
        typeof waypoints.size !== "function" ||
        typeof waypoints.get !== "function"
      ) {
        return null;
      }
      const n = waypoints.size();
      for (let i = 0; i < n; i++) {
        const wp = waypoints.get(i);
        const wpName = String(wp?.name || "")
          .trim()
          .toUpperCase();
        if (wpName !== key) continue;
        const pos = wp?.position;
        if (!pos) return null;
        return { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 };
      }
    } catch {
      // ignore lookup failures
    }
    return null;
  };

  const findVobNamedPosition = (
    worldObj: World,
    name: string,
  ): { x: number; y: number; z: number } | null => {
    const key = (name || "").trim().toUpperCase();
    if (!key) return null;

    const visit = (v: any): { x: number; y: number; z: number } | null => {
      if (!v) return null;
      const names = [v?.vobName, v?.name, v?.objectName]
        .map((n) =>
          String(n || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean);
      if (names.includes(key)) {
        const pos = v?.position;
        if (pos) return { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 };
      }
      const children = v?.children;
      if (children && typeof children.size === "function" && typeof children.get === "function") {
        const n = children.size();
        for (let i = 0; i < n; i++) {
          const found = visit(children.get(i));
          if (found) return found;
        }
      }
      return null;
    };

    try {
      const roots = (worldObj as any).getVobs?.();
      if (!roots || typeof roots.size !== "function" || typeof roots.get !== "function") {
        return null;
      }
      const n = roots.size();
      for (let i = 0; i < n; i++) {
        const found = visit(roots.get(i));
        if (found) return found;
      }
    } catch {
      // ignore lookup failures
    }
    return null;
  };

  const createIdentityRotationArray = () => ({
    size: () => 9,
    get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] ?? 0,
  });

  const collectDynamicItems = (worldObj: World, inserted: SpawnedItemData[]): VobData[] => {
    if (!inserted.length) return [];
    const out: VobData[] = [];
    for (let i = 0; i < inserted.length; i++) {
      const item = inserted[i];
      const instance = (item.symbolName || "").trim().toUpperCase();
      const spawnpoint = (item.spawnpoint || "").trim();
      const sig = `${instance}|${spawnpoint}`;
      if (consumedDynamicItemSignaturesRef.current.has(sig)) continue;
      const wpPos =
        findWaypointPosition(worldObj, spawnpoint) ?? findVobNamedPosition(worldObj, spawnpoint);
      if (!wpPos) continue;
      consumedDynamicItemSignaturesRef.current.add(sig);
      const syntheticVob: any = {
        id: `vm-item-${instance}-${spawnpoint}-${i}`,
        type: ITEM_VOB_TYPE,
        itemInstance: instance,
        showVisual: true,
        visual: { type: 1, name: "" },
        position: { x: wpPos.x, y: wpPos.y, z: wpPos.z },
        rotation: { toArray: createIdentityRotationArray },
        children: { size: () => 0, get: () => null },
      };
      out.push({
        id: syntheticVob.id,
        vob: syntheticVob as Vob,
        position: new THREE.Vector3(-wpPos.x, wpPos.y, wpPos.z),
        visualName: "",
        vobType: ITEM_VOB_TYPE,
      });
    }
    return out;
  };

  const getSymbolIndexByName = (name: string): number | null => {
    const key = (name || "").trim().toUpperCase();
    if (!key) return null;
    if (vmSymbolIndexCacheRef.current.has(key)) {
      return vmSymbolIndexCacheRef.current.get(key) ?? null;
    }
    const vm = getRuntimeVm();
    if (!vm) return null;
    const count = Number(vm.symbolCount);
    if (!Number.isFinite(count) || count <= 0) return null;
    for (let i = 0; i < count; i++) {
      const r = vm.getSymbolNameByIndex(i);
      if (!r.success || !r.data) continue;
      if ((r.data || "").trim().toUpperCase() === key) {
        vmSymbolIndexCacheRef.current.set(key, i);
        return i;
      }
    }
    return null;
  };

  // OG-style item visuals come from C_ITEM instance (`C_ITEM.visual`), not always from vob.visual.
  const resolveItemVisualFromVm = (vob: Vob, vobType: number | undefined): string => {
    if (vobType !== ITEM_VOB_TYPE) return "";
    const instanceName = ((vob as any).itemInstance || "").trim().toUpperCase();
    if (!instanceName) return "";
    if (itemVisualCacheRef.current.has(instanceName)) {
      const cached = itemVisualCacheRef.current.get(instanceName) || "";
      if (cached) return cached;
      // Empty cache entries are treated as transient misses; retry on next pass.
      itemVisualCacheRef.current.delete(instanceName);
    }
    const vm = getRuntimeVm();
    if (!vm) return "";

    try {
      const instanceIdx = getSymbolIndexByName(instanceName);
      if (instanceIdx != null && instanceIdx > 0) {
        vm.initInstanceByIndex(instanceIdx);
      }
      const visual = (vm.getSymbolString("C_ITEM.visual", instanceName) || "").trim();
      if (visual) itemVisualCacheRef.current.set(instanceName, visual);
      return visual;
    } catch {
      return "";
    }
  };

  const shouldCreateVobCollider = (vob: Vob) => {
    const vobType = getVobType(vob);
    // Skip helper visuals (lights, spots, cameras, etc.).
    if (shouldUseHelperVisual(vobType)) return false;
    // If dynamic collision is disabled for this VOB, treat it as non-collidable.
    if ((vob as any).cdDynamic === false) return false;
    return true;
  };

  const removeVobCollider = (vobId: string) => {
    if (!rapierWorld) return;
    const handle = vobColliderHandlesRef.current.get(vobId);
    if (typeof handle !== "number") return;
    const collider = rapierWorld.getCollider(handle);
    if (collider) {
      try {
        rapierWorld.removeCollider(collider, true);
      } catch {
        // Best-effort cleanup.
      }
    }
    vobColliderHandlesRef.current.delete(vobId);
  };

  const buildTrimeshFromObject = (
    obj: THREE.Object3D,
  ): { vertices: Float32Array; indices: Uint32Array } | null => {
    const vertices: number[] = [];
    const indices: number[] = [];
    let vertBase = 0;

    const shouldKeepMaterial = (mat: THREE.Material | undefined | null): boolean => {
      if (!mat) return true;
      const ud: any = (mat as any).userData;
      return !Boolean(ud?.noCollDet);
    };

    obj.updateMatrixWorld(true);
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geom = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!geom) return;
      const posAttr = geom.getAttribute("position");
      if (!posAttr) return;

      const mat = mesh.matrixWorld;
      const vx = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        vx.fromBufferAttribute(posAttr, i).applyMatrix4(mat);
        vertices.push(vx.x, vx.y, vx.z);
      }

      const index = geom.getIndex();
      const groups = geom.groups ?? [];
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (groups.length > 0) {
        for (const g of groups) {
          const matIndex = typeof g.materialIndex === "number" ? g.materialIndex : 0;
          const matForGroup = materials[matIndex] as THREE.Material | undefined;
          if (!shouldKeepMaterial(matForGroup)) continue;
          if (index) {
            const start = g.start;
            const end = g.start + g.count;
            for (let i = start; i < end; i += 3) {
              indices.push(vertBase + index.getX(i + 0));
              indices.push(vertBase + index.getX(i + 1));
              indices.push(vertBase + index.getX(i + 2));
            }
          } else {
            const start = g.start;
            const end = g.start + g.count;
            for (let i = start; i < end; i += 3) {
              indices.push(vertBase + i + 0);
              indices.push(vertBase + i + 1);
              indices.push(vertBase + i + 2);
            }
          }
        }
      } else {
        const matForMesh = materials[0] as THREE.Material | undefined;
        if (shouldKeepMaterial(matForMesh)) {
          if (index) {
            for (let i = 0; i < index.count; i++) {
              indices.push(vertBase + index.getX(i));
            }
          } else {
            for (let i = 0; i < posAttr.count; i++) {
              indices.push(vertBase + i);
            }
          }
        }
      }

      vertBase += posAttr.count;
    });

    if (vertices.length === 0 || indices.length === 0) return null;
    return {
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    };
  };

  const createVobCollider = (vobId: string, obj: THREE.Object3D, vob: Vob) => {
    if (!rapierWorld || !rapier) return;
    if (!shouldCreateVobCollider(vob)) return;
    if (vobColliderHandlesRef.current.has(vobId)) return;

    const meshData = buildTrimeshFromObject(obj);
    if (!meshData) return;

    const desc = rapier.ColliderDesc.trimesh(meshData.vertices, meshData.indices);
    // Collision groups:
    // - WORLD: membership=1, filter=all (so NPCs can collide/query with it)
    const WORLD_MEMBERSHIP = 0x0001;
    const WORLD_FILTER = 0xffff;
    desc.setCollisionGroups((WORLD_MEMBERSHIP << 16) | WORLD_FILTER);

    const collider = rapierWorld.createCollider(desc);
    vobColliderHandlesRef.current.set(vobId, collider.handle);
  };

  const applyViewVisibility = (obj: THREE.Object3D, vob: Vob) => {
    const vobType = getVobType(vob);
    if (vobType === 10) {
      obj.visible = Boolean(showLights);
    } else if (vobType === 11) {
      obj.visible = Boolean(showVobSpots);
    }
  };

  const getMaterialQueue = (material: THREE.Material | undefined | null): RenderQueue => {
    if (!material) return "opaque";
    const q = (material.userData as any)?.renderQueue as RenderQueue | undefined;
    if (q === "opaque" || q === "alphaTest" || q === "transparent") return q;
    const asAny = material as any;
    if (asAny?.transparent === true) return "transparent";
    if (typeof asAny?.alphaTest === "number" && asAny.alphaTest > 0) return "alphaTest";
    return "opaque";
  };

  const getMaterialTransparentPass = (
    material: THREE.Material | undefined | null,
  ): TransparentPass | null => {
    if (!material) return null;
    const queue = getMaterialQueue(material);
    if (queue !== "transparent") return null;

    const asAny = material as any;
    if (asAny?.blending === THREE.AdditiveBlending) return "additive";
    return "alphaBlend";
  };

  const resolveObjectTransparentPass = (obj: THREE.Object3D): TransparentPass => {
    let hasAdditive = false;
    let hasAlphaBlend = false;
    const evalObjectMaterials = (candidate: any) => {
      if (!candidate || candidate.material == null) return;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material];
      for (const m of materials) {
        const pass = getMaterialTransparentPass(m as THREE.Material | undefined);
        if (pass === "alphaBlend") {
          hasAlphaBlend = true;
          return;
        }
        if (pass === "additive") {
          hasAdditive = true;
        }
      }
    };

    if (typeof (obj as any).traverse === "function") {
      (obj as any).traverse((child: any) => {
        if (hasAlphaBlend) return;
        evalObjectMaterials(child);
      });
    } else {
      evalObjectMaterials(obj as any);
    }
    if (hasAlphaBlend) return "alphaBlend";
    if (hasAdditive) return "additive";
    return "alphaBlend";
  };

  const resolveObjectQueue = (obj: THREE.Object3D): RenderQueue => {
    let resolved: RenderQueue = "opaque";
    const evalObjectMaterials = (candidate: any) => {
      if (!candidate || candidate.material == null) return;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material];
      for (const m of materials) {
        const q = getMaterialQueue(m as THREE.Material | undefined);
        if (q === "transparent") {
          resolved = "transparent";
          return;
        }
        if (q === "alphaTest" && resolved === "opaque") {
          resolved = "alphaTest";
        }
      }
    };

    if (typeof (obj as any).traverse === "function") {
      (obj as any).traverse((child: any) => {
        evalObjectMaterials(child);
      });
    } else {
      evalObjectMaterials(obj as any);
    }
    return resolved;
  };

  const applyRenderQueue = (obj: THREE.Object3D) => {
    const queue = resolveObjectQueue(obj);
    const order = RENDER_QUEUE_ORDER[queue];
    (obj.userData as any).renderQueue = queue;
    if (queue === "transparent") {
      (obj.userData as any).transparentPass = resolveObjectTransparentPass(obj);
    } else {
      delete (obj.userData as any).transparentPass;
    }
    obj.renderOrder = order;
    if (typeof (obj as any).traverse === "function") {
      (obj as any).traverse((child: any) => {
        child.renderOrder = order;
      });
    } else {
      (obj as any).renderOrder = order;
    }
  };

  const applyRenderQueueFromMaterials = (obj: THREE.Object3D, materials: THREE.Material[]) => {
    let queue: RenderQueue = "opaque";
    let hasAdditive = false;
    let hasAlphaBlend = false;
    for (const m of materials) {
      const q = getMaterialQueue(m);
      if (q === "transparent") {
        queue = "transparent";
        const pass = getMaterialTransparentPass(m);
        if (pass === "alphaBlend") hasAlphaBlend = true;
        if (pass === "additive") hasAdditive = true;
      }
      if (q === "alphaTest" && queue === "opaque") {
        queue = "alphaTest";
      }
    }
    const order = RENDER_QUEUE_ORDER[queue];
    (obj.userData as any).renderQueue = queue;
    if (queue === "transparent") {
      (obj.userData as any).transparentPass = hasAlphaBlend
        ? "alphaBlend"
        : hasAdditive
          ? "additive"
          : "alphaBlend";
    } else {
      delete (obj.userData as any).transparentPass;
    }
    obj.renderOrder = order;
    if (typeof (obj as any).traverse === "function") {
      (obj as any).traverse((child: any) => {
        child.renderOrder = order;
      });
    }
  };

  const sortTransparentLoadedVobs = (cameraPos?: THREE.Vector3) => {
    if (!cameraPos || typeof (cameraPos as any).distanceTo !== "function") return;
    const alphaBlend: Array<{ obj: THREE.Object3D; dist: number }> = [];
    const additive: Array<{ obj: THREE.Object3D; dist: number }> = [];

    for (const obj of loadedVOBsRef.current.values()) {
      const tagged = (obj.userData as any)?.renderQueue as RenderQueue | undefined;
      const queue =
        tagged === "opaque" || tagged === "alphaTest" || tagged === "transparent"
          ? tagged
          : resolveObjectQueue(obj);
      if (queue !== "transparent") continue;
      const taggedPass = (obj.userData as any)?.transparentPass as TransparentPass | undefined;
      const pass =
        taggedPass === "alphaBlend" || taggedPass === "additive"
          ? taggedPass
          : resolveObjectTransparentPass(obj);

      const p: any = (obj as any).position;
      if (!p || typeof p.x !== "number" || typeof p.y !== "number" || typeof p.z !== "number")
        continue;
      const dist = cameraPos.distanceTo(p);
      const entry = { obj, dist: Number.isFinite(dist) ? dist : 0 };
      if (pass === "additive") {
        additive.push(entry);
      } else {
        alphaBlend.push(entry);
      }
    }

    const applySortedOrders = (
      entries: Array<{ obj: THREE.Object3D; dist: number }>,
      baseOrder: number,
    ) => {
      // Back-to-front in each transparent sub-pass.
      entries.sort((a, b) => b.dist - a.dist);
      for (let i = 0; i < entries.length; i++) {
        const order = baseOrder + i;
        const obj = entries[i].obj;
        obj.renderOrder = order;
        if (typeof (obj as any).traverse === "function") {
          (obj as any).traverse((child: any) => {
            child.renderOrder = order;
          });
        }
      }
    };

    applySortedOrders(alphaBlend, TRANSPARENT_PASS_ORDER.alphaBlend);
    applySortedOrders(additive, TRANSPARENT_PASS_ORDER.additive);
  };

  // Apply visibility toggles to already-loaded VOBs.
  useEffect(() => {
    for (const obj of loadedVOBsRef.current.values()) {
      const vob = (obj.userData as any)?.vob as Vob | undefined;
      if (!vob) continue;
      applyViewVisibility(obj, vob);
    }
  }, [showLights, showVobSpots]);

  useEffect(() => {
    // Only load once
    if (hasLoadedRef.current || !world || !zenKit) return;

    hasLoadedRef.current = true;

    const loadVOBs = async () => {
      try {
        onLoadingStatus("🔧 Collecting VOBs...");

        // Collect VOBs from world
        consumedDynamicItemSignaturesRef.current.clear();
        allVOBsRef.current = await collectVOBs(world);

        // Start the streaming loader
        onLoadingStatus(`🎬 Starting streaming VOB loader (${allVOBsRef.current.length} VOBs)...`);
        // Streaming will now be handled by useFrame hook
      } catch (error) {
        console.error("❌ Failed to load VOBs:", error);
        onLoadingStatus(`❌ Failed to load VOBs: ${(error as Error).message}`);
      }
    };

    loadVOBs();
  }, [world, zenKit, onLoadingStatus]);

  // Collect VOB data from world
  const collectVOBs = async (world: World): Promise<VobData[]> => {
    const collectedVOBs: VobData[] = [];
    const vobs = world.getVobs();
    const vobCount = vobs.size();
    console.log(`Found ${vobCount} root VOBs`);

    let totalCount = 0;
    const visualTypeCounts: { [key: string]: number } = {};

    const isSupportedVisualType = (visualType: number): boolean =>
      visualType === 1 || visualType === 2 || visualType === 5 || visualType === 6;

    // Recursive function to collect VOB data
    function collectVobTree(vob: Vob, vobId = 0) {
      totalCount++;

      // Track visual type statistics
      const typeKey = `Type_${vob.visual.type}`;
      visualTypeCounts[typeKey] = (visualTypeCounts[typeKey] || 0) + 1;

      // Get VOB type
      const vobType = getVobType(vob);
      const itemVisualName = resolveItemVisualFromVm(vob, vobType);
      const resolvedVisualName = (vob.visual.name || itemVisualName || "").trim();

      // Determine if visual is available
      const hasVisual =
        vob.showVisual &&
        resolvedVisualName &&
        (isSupportedVisualType(vob.visual.type) ||
          (vobType === ITEM_VOB_TYPE && !!itemVisualName)) &&
        !resolvedVisualName.toUpperCase().endsWith(".TEX") &&
        !resolvedVisualName.toUpperCase().endsWith(".TGA");

      // Determine visual name: use actual visual if available, otherwise use INVISIBLE_{VOBTYPENAME}.MRM
      // But exclude certain VOB types from getting helper visuals (zCVob, oCItem, oCNpc, zCVobStair)
      let visualName: string;
      if (hasVisual) {
        visualName = resolvedVisualName;
      } else if (shouldUseHelperVisual(vobType)) {
        const vobTypeName = getVobTypeName(vobType);
        visualName = vobTypeName ? `INVISIBLE_${vobTypeName}.MRM` : "";
      } else {
        visualName = "";
      }

      // Keep oCItem entries even if visual is unresolved yet; we'll retry once VM is ready.
      const shouldKeepItemForLateResolve = vobType === ITEM_VOB_TYPE;
      // Only store VOBs that have visible meshes OR have a valid VOB type (for invisible helper visuals),
      // plus oCItem entries for late visual resolve.
      if (
        hasVisual ||
        (visualName && vobType !== undefined && vobType !== null) ||
        shouldKeepItemForLateResolve
      ) {
        collectedVOBs.push({
          id: `${vobId}_${totalCount}`,
          vob: vob,
          position: new THREE.Vector3(-vob.position.x, vob.position.y, vob.position.z),
          visualName: visualName!,
          vobType: vobType,
        });
      }

      // Process children recursively
      const childCount = vob.children.size();
      for (let i = 0; i < childCount; i++) {
        collectVobTree(vob.children.get(i), vobId);
      }
    }

    // Collect all VOBs
    for (let i = 0; i < vobCount; i++) {
      const vob = vobs.get(i);
      collectVobTree(vob, i);
    }

    console.log(`📊 Total VOBs (including children): ${totalCount}`);
    console.log(`📊 Renderable VOBs: ${collectedVOBs.length}`);

    const typeNames = [
      "DECAL",
      "MESH",
      "MULTI_RES_MESH",
      "PARTICLE",
      "CAMERA",
      "MODEL",
      "MORPH_MESH",
      "UNKNOWN",
    ];
    console.log("📊 Visual type breakdown:");
    Object.keys(visualTypeCounts)
      .sort()
      .forEach((key) => {
        const typeNum = parseInt(key.split("_")[1]);
        const typeName = typeNames[typeNum] || "UNKNOWN";
        console.log(`   ${typeName} (${typeNum}): ${visualTypeCounts[key]}`);
      });
    return collectedVOBs;
  };

  // Streaming VOB loader - loads/unloads based on camera distance
  const updateVOBStreaming = () => {
    const config = {
      loadDistance: VOB_LOAD_DISTANCE,
      unloadDistance: VOB_UNLOAD_DISTANCE,
      updateThreshold: 100,
      updateInterval: 10,
    };

    const { shouldUpdate, cameraPos } = shouldUpdateStreaming(
      streamingState.current,
      cameraPosition,
      config,
    );

    if (shouldUpdate) {
      // Find VOBs to load/unload using shared utility
      const { toLoad, toUnload } = getItemsToLoadUnload(
        allVOBsRef.current,
        cameraPos,
        config,
        loadedVOBsRef.current,
      );

      // Add items to load queue
      vobLoadQueueRef.current = toLoad;

      // Unload distant VOBs
      for (const id of toUnload) {
        const mesh = loadedVOBsRef.current.get(id);
        if (mesh) {
          scene.remove(mesh);
          disposeObject3D(mesh);
          loadedVOBsRef.current.delete(id);
          removeVobCollider(id);
        }
      }

      // Sort queue by distance (closest first)
      vobLoadQueueRef.current.sort((a, b) => {
        return cameraPos.distanceTo(a.position) - cameraPos.distanceTo(b.position);
      });
    }

    // Load multiple VOBs concurrently (up to MAX_CONCURRENT_LOADS) to speed up loading
    const currentlyLoading = loadingVOBsRef.current.size;
    const availableSlots = MAX_CONCURRENT_LOADS - currentlyLoading;

    // Start loading new VOBs if we have available slots and items in queue
    for (let i = 0; i < Math.min(availableSlots, vobLoadQueueRef.current.length); i++) {
      const vobData = vobLoadQueueRef.current.shift();
      if (vobData) {
        loadingVOBsRef.current.add(vobData.id);

        renderVOB(vobData.vob, vobData.id, vobData).then((success) => {
          loadingVOBsRef.current.delete(vobData.id);
          if (!success) {
            console.warn(`❌ Failed to render VOB: ${vobData.visualName}`);
          }
        });
      }
    }

    // Update debug info and stats
    const loadedCount = loadedVOBsRef.current.size;
    const totalCount = allVOBsRef.current.length;
    const queueCount = vobLoadQueueRef.current.length;

    // Report stats to parent component
    if (onVobStats) {
      onVobStats({
        loaded: loadedCount,
        total: totalCount,
        queue: queueCount, // Items waiting in queue
        loading: currentlyLoading, // Items currently being loaded
        meshCache: meshCacheRef.current.size,
        morphCache: morphMeshCacheRef.current.size,
        textureCache: textureCacheRef.current.size,
      });
    }

    // Streaming continues via useFrame hook
  };

  // Alternative approach: use useFrame for continuous streaming updates
  useFrame(() => {
    if (hasLoadedRef.current && allVOBsRef.current.length > 0) {
      updateVOBStreaming();
      sortTransparentLoadedVobs(cameraPosition);
    }
  });

  useEffect(() => {
    if (!world || !hasLoadedRef.current || dynamicItems.length === 0) return;
    const newItems = collectDynamicItems(world, dynamicItems);
    if (newItems.length === 0) return;
    allVOBsRef.current = [...allVOBsRef.current, ...newItems];
    vobLoadQueueRef.current = [...newItems, ...vobLoadQueueRef.current];
  }, [world, dynamicItems]);

  useEffect(() => {
    return () => {
      if (!rapierWorld) return;
      for (const handle of vobColliderHandlesRef.current.values()) {
        const collider = rapierWorld.getCollider(handle);
        if (collider) {
          try {
            rapierWorld.removeCollider(collider, true);
          } catch {
            // Best-effort cleanup.
          }
        }
      }
      vobColliderHandlesRef.current.clear();
    };
  }, [rapierWorld]);

  // Main VOB rendering dispatcher
  const renderVOB = async (
    vob: Vob,
    vobId: string | null = null,
    vobData?: VobData,
  ): Promise<boolean> => {
    // Get visual name from vobData if available, otherwise from vob
    let visualName = vobData?.visualName ?? vob.visual.name;
    const vobType = vobData?.vobType ?? getVobType(vob);
    const isItemVisualFallback = vobType === ITEM_VOB_TYPE;

    // Late resolve for items collected before VM was ready.
    if (!visualName && isItemVisualFallback) {
      const lateVisual = resolveItemVisualFromVm(vob, vobType);
      if (lateVisual) {
        visualName = lateVisual;
        if (vobData) vobData.visualName = lateVisual;
      }
    }

    // Skip if no visual name
    if (!visualName) return false;

    // Check if this is a helper visual (visual name starts with INVISIBLE_)
    const isHelperVisual = shouldUseHelperVisual(vobData?.vobType);

    // Skip if visual disabled (unless it's a helper visual or oCItem fallback visual)
    if (!isHelperVisual && !isItemVisualFallback && !vob.showVisual) return false;

    // Skip if visual name has texture extension (indicates it's not a mesh)
    if (visualName.toUpperCase().endsWith(".TEX") || visualName.toUpperCase().endsWith(".TGA"))
      return false;

    // For helper visuals, treat as regular mesh
    if (isHelperVisual) {
      const meshPath = getMeshPath(visualName);
      if (!meshPath) {
        return false;
      }
      return await renderMeshVOB(vob, vobId, meshPath);
    }

    // Only render mesh/model/morph visuals
    // Type 0 = DECAL (sprite/texture, not 3D mesh)
    // Type 1 = MESH (static 3D mesh)
    // Type 2 = MULTI_RESOLUTION_MESH (LOD mesh)
    // Type 3 = PARTICLE_EFFECT, 4 = AI_CAMERA, 5 = MODEL, 6 = MORPH_MESH
    if (
      !isItemVisualFallback &&
      vob.visual.type !== 1 &&
      vob.visual.type !== 2 &&
      vob.visual.type !== 5 &&
      vob.visual.type !== 6
    ) {
      return false; // Skip non-mesh visuals (decals, particles, etc.)
    }

    // Item visuals frequently come from C_ITEM.visual and may not match vob.visual.type.
    // For items, prefer the visual extension over vob.visual.type.
    if (isItemVisualFallback) {
      const upper = visualName.toUpperCase();
      if (upper.endsWith(".MDL") || upper.endsWith(".MDS")) {
        return await renderModelVOB(vob, vobId, visualName);
      }
      if (upper.endsWith(".MMB") || upper.endsWith(".MMS") || upper.endsWith(".MMSB")) {
        return await renderMorphMeshVOB(vob, vobId, visualName);
      }
      if (vob.visual.type === 5) {
        return await renderModelVOB(vob, vobId, visualName);
      }
      if (vob.visual.type === 6) {
        return await renderMorphMeshVOB(vob, vobId, visualName);
      }
      const meshPath = getMeshPath(visualName);
      if (!meshPath) return false;
      return await renderMeshVOB(vob, vobId, meshPath);
    }

    // Handle different visual types
    if (vob.visual.type === 5) {
      // MODEL (5) - load .MDL file
      return await renderModelVOB(vob, vobId, visualName);
    } else if (vob.visual.type === 6) {
      // MORPH_MESH (6) - load .MMB file
      return await renderMorphMeshVOB(vob, vobId, visualName);
    } else {
      // MESH (1) or MULTI_RES_MESH (2) - load mesh file
      const meshPath = getMeshPath(visualName);
      if (!meshPath) {
        return false;
      }

      return await renderMeshVOB(vob, vobId, meshPath);
    }
  };

  // Render mesh VOB
  const renderMeshVOB = async (
    vob: Vob,
    vobId: string | null,
    meshPath: string,
  ): Promise<boolean> => {
    if (!zenKit) return false;

    try {
      // Load mesh with caching
      const processed = await loadMeshCached(meshPath, zenKit, meshCacheRef.current);
      if (!processed) {
        return false;
      }

      // Build Three.js geometry and materials
      const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
        processed,
        zenKit,
        textureCacheRef.current,
        materialCacheRef.current,
      );

      // Verify geometry has data
      if (
        !geometry ||
        geometry.attributes.position === undefined ||
        geometry.attributes.position.count === 0
      ) {
        console.warn(`⚠️ Empty geometry for VOB: ${vob.visual.name}`);
        return false;
      }

      // Create mesh
      const vobMeshObj = new THREE.Mesh(geometry, materials);

      // Store VOB reference for click detection
      vobMeshObj.userData.vob = vob;

      // Verify materials
      if (!materials || (Array.isArray(materials) && materials.length === 0)) {
        console.warn(`⚠️ No materials for VOB: ${vob.visual.name}`);
      }

      // Apply VOB transform
      applyVobTransform(vobMeshObj, vob);
      applyViewVisibility(vobMeshObj, vob);
      applyRenderQueueFromMaterials(vobMeshObj, materials as THREE.Material[]);

      // Register loaded VOB and add to scene
      if (vobId) {
        loadedVOBsRef.current.set(vobId, vobMeshObj);
        scene.add(vobMeshObj);
        createVobCollider(vobId, vobMeshObj, vob);

        // Verify it's actually in the scene
        if (!scene.children.includes(vobMeshObj)) {
          console.error(`❌ ERROR: VOB was not added to scene! ${vob.visual.name}`);
        }
      } else {
        console.warn(`⚠️ Skipping VOB add to scene - no vobId: ${vob.visual.name}`);
      }

      return true;
    } catch (error) {
      console.warn(`Failed to render mesh VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Render model VOB
  const renderModelVOB = async (
    vob: Vob,
    vobId: string | null,
    visualNameOverride?: string,
  ): Promise<boolean> => {
    if (!zenKit) return false;

    try {
      const visualName = visualNameOverride ?? vob.visual.name;

      // Build model path - convert to .MDL file
      const modelPath = getModelPath(visualName);
      if (!modelPath) {
        return false;
      }

      // Load model with caching
      const model = await loadModelCached(modelPath, zenKit);
      if (!model) {
        return false;
      }

      // Check for attachments first
      const attachmentNames = model.getAttachmentNames();
      const attachmentCount = attachmentNames.size();

      // Check for soft-skin meshes if no attachments
      if (attachmentCount === 0) {
        // TypeScript may not recognize these methods, but they exist at runtime
        const softSkinMeshes = (model as any).getSoftSkinMeshes?.();
        const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;

        if (softSkinCount === 0) {
          return false;
        }

        // Render soft-skin meshes
        // In OpenGothic, soft-skin meshes use skeleton transforms, but for static models
        // they're positioned relative to the root node translation
        const hierarchy = model.getHierarchy();
        const modelGroup = new THREE.Group();

        // Store VOB reference for click detection
        modelGroup.userData.vob = vob;

        // Get root translation from hierarchy (similar to OpenGothic's mkBaseTranslation)
        // OpenGothic's mkBaseTranslation() extracts from processed root node transform and negates it
        // We use the hierarchy's root_translation directly, negated
        let rootNodeTranslation = new THREE.Vector3(0, 0, 0);
        if (hierarchy.rootTranslation) {
          rootNodeTranslation.set(
            -hierarchy.rootTranslation.x,
            -hierarchy.rootTranslation.y,
            -hierarchy.rootTranslation.z,
          );
        }

        for (let i = 0; i < softSkinCount; i++) {
          const softSkinMesh = softSkinMeshes.get(i);
          if (!softSkinMesh) continue;

          // Convert soft-skin mesh to processed mesh data
          const processed = (model as any).convertSoftSkinMeshToProcessedMesh(softSkinMesh);
          if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
            continue;
          }

          // Build Three.js geometry and materials
          const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
            processed,
            zenKit,
            textureCacheRef.current,
            materialCacheRef.current,
          );

          // Create mesh - soft-skin meshes are positioned relative to root node
          // Apply root node translation offset (similar to OpenGothic's mkBaseTranslation logic)
          const softSkinMeshObj = new THREE.Mesh(geometry, materials);
          softSkinMeshObj.position.copy(rootNodeTranslation);

          modelGroup.add(softSkinMeshObj);
        }

        if (modelGroup.children.length === 0) {
          return false;
        }

        // Apply VOB transform
        applyVobTransform(modelGroup, vob);
        applyViewVisibility(modelGroup, vob);
        applyRenderQueue(modelGroup);
        scene.add(modelGroup);

        if (vobId) {
          loadedVOBsRef.current.set(vobId, modelGroup);
          createVobCollider(vobId, modelGroup, vob);
        }

        return true;
      }

      // Get the model hierarchy to position attachments correctly
      const hierarchy = model.getHierarchy();

      // Create a group to hold all attachment meshes
      const modelGroup = new THREE.Group();

      // Store VOB reference for click detection
      modelGroup.userData.vob = vob;

      // Helper function to accumulate transforms up the hierarchy chain
      function getAccumulatedTransform(nodeIndex: number) {
        let currentIndex = nodeIndex;
        let accumulatedMatrix = new THREE.Matrix4();

        // Walk from leaf to root, accumulating transforms
        while (currentIndex >= 0) {
          const node = hierarchy.nodes.get
            ? hierarchy.nodes.get(currentIndex)
            : hierarchy.nodes[currentIndex];
          const nodeTransform = node.getTransform();
          const nodeMatrix = new THREE.Matrix4();

          // Convert column-major matrix data to Three.js Matrix4
          const matrixData = nodeTransform.toArray();
          for (let i = 0; i < 16; i++) {
            nodeMatrix.elements[i] = matrixData[i];
          }

          // Pre-multiply: accumulated = node * accumulated
          const tempMatrix = new THREE.Matrix4();
          tempMatrix.multiplyMatrices(nodeMatrix, accumulatedMatrix);
          accumulatedMatrix = tempMatrix;

          currentIndex = node.parentIndex;
        }

        return accumulatedMatrix;
      }

      // Render each attachment with proper positioning from hierarchy
      for (let i = 0; i < attachmentCount; i++) {
        const attachmentName = attachmentNames.get(i);
        const attachment = model.getAttachment(attachmentName);
        if (!attachment) continue;

        // Find the corresponding hierarchy node for this attachment
        let hierarchyNodeIndex = -1;
        const nodeCount = hierarchy.nodes.size
          ? hierarchy.nodes.size()
          : (hierarchy.nodes.length ?? 0);
        for (let j = 0; j < nodeCount; j++) {
          const node = hierarchy.nodes.get ? hierarchy.nodes.get(j) : hierarchy.nodes[j];
          if (node && node.name === attachmentName) {
            hierarchyNodeIndex = j;
            break;
          }
        }

        // Convert attachment to processed mesh data
        const processed = model.convertAttachmentToProcessedMesh(attachment);
        if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
          continue;
        }

        // Build Three.js geometry and materials using shared function
        const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
          processed,
          zenKit,
          textureCacheRef.current,
          materialCacheRef.current,
        );

        // Create mesh for this attachment
        const attachmentMesh = new THREE.Mesh(geometry, materials);

        // Apply accumulated hierarchy transform if found
        if (hierarchyNodeIndex >= 0) {
          const accumulatedMatrix = getAccumulatedTransform(hierarchyNodeIndex);
          attachmentMesh.applyMatrix4(accumulatedMatrix);
        }

        modelGroup.add(attachmentMesh);
      }

      if (modelGroup.children.length === 0) {
        return false;
      }

      // Apply VOB transform using the same approach as regular VOBs
      applyVobTransform(modelGroup, vob);
      applyViewVisibility(modelGroup, vob);
      applyRenderQueue(modelGroup);

      // Register loaded VOB and add to scene
      if (vobId) {
        loadedVOBsRef.current.set(vobId, modelGroup);
        scene.add(modelGroup);
        createVobCollider(vobId, modelGroup, vob);

        // Verify it's actually in the scene
        if (!scene.children.includes(modelGroup)) {
          console.error(`❌ ERROR: Model VOB was not added to scene! ${vob.visual.name}`);
        }
      } else {
        console.warn(`⚠️ Skipping model VOB add to scene - no vobId: ${vob.visual.name}`);
      }

      return true;
    } catch (error) {
      console.warn(`Failed to render model VOB ${visualNameOverride ?? vob.visual.name}:`, error);
      return false;
    }
  };

  // Render morph mesh VOB
  const renderMorphMeshVOB = async (
    vob: Vob,
    vobId: string | null,
    visualNameOverride?: string,
  ): Promise<boolean> => {
    if (!zenKit) return false;

    try {
      const visualName = visualNameOverride ?? vob.visual.name;

      // Build morph mesh path - convert to .MMB file
      const morphPath = getMorphMeshPath(visualName);
      if (!morphPath) {
        return false;
      }

      // Load morph mesh with caching
      const morphData = await loadMorphMeshCached(morphPath, zenKit);
      if (!morphData) {
        return false;
      }

      // Build Three.js geometry and materials from processed mesh data
      const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
        morphData.processed,
        zenKit,
        textureCacheRef.current,
        materialCacheRef.current,
      );

      if (!geometry) {
        return false;
      }

      // Create mesh with materials
      const morphMesh = new THREE.Mesh(geometry, materials);

      // Store VOB reference for click detection
      morphMesh.userData.vob = vob;

      // Apply VOB transform
      applyVobTransform(morphMesh, vob);
      applyViewVisibility(morphMesh, vob);
      applyRenderQueue(morphMesh);

      // Register loaded VOB and add to scene
      if (vobId) {
        loadedVOBsRef.current.set(vobId, morphMesh);
        scene.add(morphMesh);
        createVobCollider(vobId, morphMesh, vob);

        // Verify it's actually in the scene
        if (!scene.children.includes(morphMesh)) {
          console.error(`❌ ERROR: Morph mesh VOB was not added to scene! ${vob.visual.name}`);
        }
      } else {
        console.warn(`⚠️ Skipping morph mesh VOB add to scene - no vobId: ${vob.visual.name}`);
      }

      return true;
    } catch (error) {
      console.warn(
        `Failed to render morph mesh VOB ${visualNameOverride ?? vob.visual.name}:`,
        error,
      );
      return false;
    }
  };

  // Cached model loader for .MDL files
  const loadModelCached = async (modelPath: string, zenKit: ZenKit): Promise<Model | null> => {
    // Check cache first
    const cached = modelCacheRef.current.get(modelPath);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(modelPath);

      // Check if .MDL doesn't exist (404 or returns HTML)
      const contentType = response.headers.get("content-type") || "";
      const is404 = !response.ok || contentType.includes("text/html");

      if (is404) {
        // Try loading .MDH and .MDM separately
        const basePath = modelPath.replace(/\.MDL$/i, "");
        const mdhPath = `${basePath}.MDH`;
        const mdmPath = `${basePath}.MDM`;

        try {
          // Load hierarchy (.MDH)
          const mdhResponse = await fetch(mdhPath);
          if (!mdhResponse.ok) {
            return null;
          }

          const mdhArrayBuffer = await mdhResponse.arrayBuffer();
          const mdhUint8Array = new Uint8Array(mdhArrayBuffer);

          const hierarchyLoader = zenKit.createModelHierarchyLoader();
          const mdhLoadResult = hierarchyLoader.loadFromArray(mdhUint8Array);

          if (!mdhLoadResult || !mdhLoadResult.success) {
            return null;
          }

          // Load mesh (.MDM)
          const mdmResponse = await fetch(mdmPath);
          if (!mdmResponse.ok) {
            return null;
          }

          const mdmArrayBuffer = await mdmResponse.arrayBuffer();
          const mdmUint8Array = new Uint8Array(mdmArrayBuffer);

          const meshLoader = zenKit.createModelMeshLoader();
          const mdmLoadResult = meshLoader.loadFromArray(mdmUint8Array);

          if (!mdmLoadResult || !mdmLoadResult.success) {
            return null;
          }

          // Combine hierarchy and mesh into a Model
          const model = zenKit.createModel();
          model.setHierarchy(hierarchyLoader.getHierarchy());
          model.setMesh(meshLoader.getMesh());

          // Cache and return
          modelCacheRef.current.set(modelPath, model);
          return model;
        } catch (error: unknown) {
          return null;
        }
      }

      // Load .MDL file normally
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load model with ZenKit
      const model = zenKit.createModel();
      const loadResult = model.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        console.warn(`Failed to load model ${modelPath}:`, model.getLastError());
        return null;
      }

      // Check for attachments FIRST, before checking isLoaded
      const attachmentNames = model.getAttachmentNames();
      const hasAttachments = attachmentNames && attachmentNames.size && attachmentNames.size() > 0;

      // Only reject if BOTH isLoaded is false AND there are no attachments
      if (!model.isLoaded && !hasAttachments) {
        return null;
      }

      // Cache and return
      modelCacheRef.current.set(modelPath, model);
      return model;
    } catch (error: unknown) {
      console.warn(`Failed to load model ${modelPath}:`, error);
      return null;
    }
  };

  // Cached morph mesh loader for .MMB files
  const loadMorphMeshCached = async (
    morphPath: string,
    zenKit: ZenKit,
  ): Promise<{
    morphMesh: MorphMesh;
    processed: ProcessedMeshData;
    animations: string[];
  } | null> => {
    // Check cache first
    const cached = morphMeshCacheRef.current.get(morphPath);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(morphPath);
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load morph mesh with ZenKit
      const morphMesh = zenKit.createMorphMesh();
      const loadResult = morphMesh.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        console.warn(`Failed to load morph mesh ${morphPath}:`, morphMesh.getLastError());
        return null;
      }

      if (!morphMesh.isLoaded) {
        console.warn(`Morph mesh ${morphPath} loaded but reports not loaded`);
        return null;
      }

      // Get processed mesh data for rendering
      const processed = morphMesh.convertToProcessedMesh();
      const animationNames = morphMesh.getAnimationNames();
      const animationCount = animationNames.size();
      const animations: string[] = [];
      for (let i = 0; i < animationCount; i++) {
        animations.push(animationNames.get(i));
      }

      const result = {
        morphMesh: morphMesh,
        processed: processed,
        animations: animations,
      };

      // Cache and return
      morphMeshCacheRef.current.set(morphPath, result);
      return result;
    } catch (error: unknown) {
      console.warn(`Failed to load morph mesh ${morphPath}:`, error);
      return null;
    }
  };

  // Helper function to apply VOB transform to an object
  const applyVobTransform = (object: THREE.Object3D, vob: Vob) => {
    // Apply VOB transform using OpenGothic's approach
    // rotation.toArray() returns an Emscripten FloatArrayLike object
    const rotArray = vob.rotation.toArray();

    // Extract rotation matrix values from Emscripten TypedArrayLike
    const m: number[] = [];
    for (let i = 0; i < rotArray.size(); i++) {
      m.push(rotArray.get(i));
    }

    // Build transform matrix exactly like OpenGothic does
    const transformMat = new THREE.Matrix4();
    transformMat.set(
      -m[0],
      -m[3],
      -m[6],
      -vob.position.x, // Negate X components for mirroring
      m[1],
      m[4],
      m[7],
      vob.position.y,
      m[2],
      m[5],
      m[8],
      vob.position.z,
      0,
      0,
      0,
      1,
    );

    // Decompose matrix into position, quaternion, scale for Three.js
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    transformMat.decompose(pos, quat, scale);

    object.position.copy(pos);
    object.quaternion.copy(quat);
    object.scale.copy(scale);
  };

  const [selectedVobObject, setSelectedVobObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!selectedVob) {
      setSelectedVobObject(null);
      return;
    }

    const vobData = allVOBsRef.current.find((vd) => vd.vob.id === selectedVob.id);
    if (!vobData) {
      setSelectedVobObject(null);
      return;
    }

    const renderedObject = loadedVOBsRef.current.get(vobData.id);
    if (renderedObject) {
      setSelectedVobObject(renderedObject);
    } else {
      setSelectedVobObject(null);

      if (!loadingVOBsRef.current.has(vobData.id)) {
        loadingVOBsRef.current.add(vobData.id);
        renderVOB(vobData.vob, vobData.id, vobData).then((success) => {
          loadingVOBsRef.current.delete(vobData.id);
          if (success) {
            const loadedObj = loadedVOBsRef.current.get(vobData.id);
            if (loadedObj) {
              setSelectedVobObject(loadedObj);
            }
          }
        });
      }
    }
  }, [selectedVob]);

  useEffect(() => {
    if (!selectedVobObject || !onSelectedVobBoundingBox) {
      return;
    }

    const timeoutId = setTimeout(() => {
      selectedVobObject.updateMatrixWorld(true);

      const box = new THREE.Box3();
      box.setFromObject(selectedVobObject);

      if (box.isEmpty()) {
        return;
      }

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      if (size.x > 0 && size.y > 0 && size.z > 0) {
        onSelectedVobBoundingBox(center, size);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedVobObject, onSelectedVobBoundingBox]);

  // Objects are added directly to the scene, but we can return JSX for the bounding box
  return (
    <>
      {selectedVobObject && (
        <VOBBoundingBox vobObject={selectedVobObject} visible={true} color="#ffff00" />
      )}
    </>
  );
}

export { VOBRenderer };
