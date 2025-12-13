import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, getItemsToLoadUnload, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { findActiveRoutineWaypoint, getMapKey, createNpcMesh } from './npc-utils';
import { findVobByName } from './vob-utils';
import { MDSViewerIntegration } from './mds-viewer-integration.js';

interface NpcRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  npcs: Map<number, NpcData>;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
}

/**
 * NPC Renderer Component - renders NPCs at spawnpoint locations with distance-based streaming
 * Uses imperative Three.js rendering (like VOBs) for better performance
 * 
 * Features:
 * - Looks up spawnpoints by name (waypoints first, then VOBs) - matching original engine behavior
 * - Renders NPCs as character models with name labels (falls back to green placeholder while loading)
 * - Handles coordinate conversion from Gothic to Three.js space
 * - Distance-based streaming: only renders NPCs near the camera for performance
 * - Prioritizes routine waypoints: NPCs are positioned at their routine waypoint for the current time (10:00)
 * 
 * Waypoint lookup priority:
 * 1. Routine waypoint active at current time (10:00) - highest priority
 * 2. Spawnpoint waypoint/VOB (fallback if no active routine)
 * 
 * Spawnpoint lookup order (for the selected waypoint name):
 * 1. Waypoint by name
 * 2. VOB by name (searches entire VOB tree)
 * 3. If neither found, shows warning
 */
export function NpcRenderer({ world, zenKit, npcs, cameraPosition, enabled = true }: NpcRendererProps) {
  const { scene, camera, gl } = useThree();
  const npcsGroupRef = useRef<THREE.Group>(null);

  // Distance-based streaming
  const loadedNpcsRef = useRef(new Map<string, THREE.Group>()); // npc id -> THREE.Group
  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3 }>>([]); // All NPC data
  const NPC_LOAD_DISTANCE = 5000; // Load NPCs within this distance
  const NPC_UNLOAD_DISTANCE = 6000; // Unload NPCs beyond this distance

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

  // Create a stable serialized key from the Map for dependency tracking
  const npcsKey = getMapKey(npcs);

  // Convert NPC data to renderable NPCs with spawnpoint positions (only compute positions, not render)
  const npcsWithPositions = useMemo(() => {
    if (!world || !enabled || npcs.size === 0) {
      return [];
    }

    const renderableNpcs: Array<{ npcData: NpcData; position: THREE.Vector3 }> = [];
    const CURRENT_HOUR = 10; // Assume current time is 10:00
    const CURRENT_MINUTE = 0;

    for (const [, npcData] of npcs.entries()) {
      let position: [number, number, number] | null = null;
      let waypointName: string | null = null;

      // Priority 1: Check routine waypoint at current time (10:00)
      const routineWaypoint = findActiveRoutineWaypoint(npcData.dailyRoutine, CURRENT_HOUR, CURRENT_MINUTE);
      if (routineWaypoint) {
        waypointName = routineWaypoint;
      } else {
        // Priority 2: Fall back to spawnpoint if no routine is active
        waypointName = npcData.spawnpoint;
      }

      // First, try to find waypoint by name (matching original engine behavior)
      const wpResult = world.findWaypointByName(waypointName);

      if (wpResult.success && wpResult.data) {
        const wp = wpResult.data;
        // Convert Gothic coordinates to Three.js coordinates: (-x, y, z)
        position = [
          -wp.position.x,
          wp.position.y,
          wp.position.z
        ];
      } else {
        // If waypoint not found, try to find VOB by name (fallback)
        const vobs = world.getVobs();
        const vobCount = vobs.size();

        for (let i = 0; i < vobCount; i++) {
          const rootVob = vobs.get(i);
          const foundVob = findVobByName(rootVob, waypointName);

          if (foundVob) {
            // Convert Gothic coordinates to Three.js coordinates: (-x, y, z)
            position = [
              -foundVob.position.x,
              foundVob.position.y,
              foundVob.position.z
            ];
            break;
          }
        }
      }

      if (position) {
        renderableNpcs.push({
          npcData,
          position: new THREE.Vector3(position[0], position[1], position[2])
        });
      } else {
        const source = routineWaypoint ? `routine waypoint "${routineWaypoint}"` : `spawnpoint "${npcData.spawnpoint}"`;
        console.warn(`⚠️ Could not find ${source} (waypoint or VOB) for NPC ${npcData.symbolName}`);
      }
    }

    return renderableNpcs;
  }, [world, npcsKey, enabled]);

  // Store NPCs with positions for streaming
  useEffect(() => {
    allNpcsRef.current = npcsWithPositions;
  }, [npcsWithPositions]);

  const loadNpcCharacter = async (npcGroup: THREE.Group, npcData: NpcData) => {
    if (!zenKit) return;
    if (npcGroup.userData.mdsIntegration) return;

    const integration = new MDSViewerIntegration(zenKit, scene, camera, gl);
    integration.setParent(npcGroup);
    integration.setRenderOptions({
      align: 'ground',
      mirrorX: true,
      showSkeletonHelper: false,
      renderNow: false,
    });

    npcGroup.userData.mdsIntegration = integration;
    npcGroup.userData.modelLoading = true;

    try {
      await integration.loadMdsFile('HumanS.mds', null);
      if (npcGroup.userData.isDisposed) return;

      // Optional: play a simple looping animation (safe to fail if assets missing)
      await integration.playAnimationLoop('S_RUN');
      integration.update(0);
      if (npcGroup.userData.isDisposed) return;

      const placeholder = npcGroup.getObjectByName('npc-placeholder');
      if (placeholder) {
        npcGroup.remove(placeholder);
        disposeObject3D(placeholder);
      }

      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      const modelObj = integration.getModelObject();
      if (sprite && modelObj) {
        npcGroup.updateMatrixWorld(true);
        modelObj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(modelObj);
        const center = box.getCenter(new THREE.Vector3());
        const topWorld = new THREE.Vector3(center.x, box.max.y, center.z);
        const topLocal = npcGroup.worldToLocal(topWorld);
        sprite.position.y = topLocal.y + 25;
      }

      npcGroup.userData.modelLoaded = true;
    } catch (error) {
      console.warn(`Failed to load NPC character model for ${npcData.symbolName}:`, error);
    } finally {
      npcGroup.userData.modelLoading = false;
      if (npcGroup.userData.isDisposed) {
        integration.dispose();
        disposeObject3D(npcGroup);
      }
    }
  };

  // Streaming NPC loader - loads/unloads based on camera distance
  const updateNpcStreaming = () => {
    if (!enabled || allNpcsRef.current.length === 0 || !world) {
      return;
    }

    const config = {
      loadDistance: NPC_LOAD_DISTANCE,
      unloadDistance: NPC_UNLOAD_DISTANCE,
      updateThreshold: 100,
      updateInterval: 10,
    };

    // Use the Three.js camera position directly if cameraPosition prop is not provided or is at origin
    const effectiveCameraPos = cameraPosition || (camera ? camera.position : undefined);

    const { shouldUpdate, cameraPos } = shouldUpdateStreaming(
      streamingState.current,
      effectiveCameraPos,
      config
    );

    if (shouldUpdate) {
      // Convert NPCs to streamable items with positions for distance checking
      const npcItems = allNpcsRef.current.map(npc => ({
        id: `npc-${npc.npcData.instanceIndex}`,
        position: npc.position,
      }));

      // Keep already-loaded NPCs in sync with their latest computed positions
      for (const npc of allNpcsRef.current) {
        const id = `npc-${npc.npcData.instanceIndex}`;
        const npcGroup = loadedNpcsRef.current.get(id);
        if (npcGroup) {
          npcGroup.position.copy(npc.position);
        }
      }

      // Find NPCs to load/unload using shared utility
      const { toLoad, toUnload } = getItemsToLoadUnload(
        npcItems,
        cameraPos,
        config,
        loadedNpcsRef.current
      );

      // Load new NPCs
      for (const item of toLoad) {
        const npc = allNpcsRef.current.find(n => `npc-${n.npcData.instanceIndex}` === item.id);
        if (!npc) continue;

        // Create NPC mesh imperatively
        const npcGroup = createNpcMesh(npc.npcData, npc.position);
        loadedNpcsRef.current.set(item.id, npcGroup);

        // Ensure NPCs group exists
        if (!npcsGroupRef.current) {
          const group = new THREE.Group();
          group.name = 'NPCs';
          npcsGroupRef.current = group;
          scene.add(group);
        }
        npcsGroupRef.current.add(npcGroup);

        // Load real model asynchronously (replaces placeholder)
        void loadNpcCharacter(npcGroup, npc.npcData);
      }

      // Unload distant NPCs
      for (const npcId of toUnload) {
        const npcGroup = loadedNpcsRef.current.get(npcId);
        if (npcGroup && npcsGroupRef.current) {
          npcGroup.userData.isDisposed = true;
          const integration = npcGroup.userData.mdsIntegration as MDSViewerIntegration | undefined;
          const isLoading = Boolean(npcGroup.userData.modelLoading);
          if (integration && !isLoading) integration.dispose();
          npcsGroupRef.current.remove(npcGroup);
          disposeObject3D(npcGroup);
          loadedNpcsRef.current.delete(npcId);
        }
      }
    }
  };

  // Streaming update via useFrame
  useFrame((_state, delta) => {
    if (allNpcsRef.current.length > 0) {
      updateNpcStreaming();
    }

    if (!enabled || loadedNpcsRef.current.size === 0) return;

    const cameraPos = cameraPosition || (camera ? camera.position : undefined);
    if (!cameraPos) return;

    for (const npcGroup of loadedNpcsRef.current.values()) {
      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (sprite) {
        sprite.lookAt(cameraPos);
      }

      const integration = npcGroup.userData.mdsIntegration as MDSViewerIntegration | undefined;
      if (integration) {
        integration.update(delta);
      }
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (npcsGroupRef.current) {
        scene.remove(npcsGroupRef.current);
        // Dispose all NPCs
        for (const npcGroup of loadedNpcsRef.current.values()) {
          npcGroup.userData.isDisposed = true;
          const integration = npcGroup.userData.mdsIntegration as MDSViewerIntegration | undefined;
          const isLoading = Boolean(npcGroup.userData.modelLoading);
          if (integration && !isLoading) integration.dispose();
          disposeObject3D(npcGroup);
        }
        loadedNpcsRef.current.clear();
        npcsGroupRef.current = null;
      }
    };
  }, [scene]);

  // Component doesn't render anything directly (uses imperative scene manipulation)
  return null;
}
