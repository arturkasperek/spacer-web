import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, getItemsToLoadUnload, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { findActiveRoutineWaypoint, getMapKey, createNpcMesh } from './npc-utils';
import { findVobByName } from './vob-utils';

interface NpcRendererProps {
  world: World | null;
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
 * - Renders NPCs as green boxes with name labels (imperative Three.js objects)
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
export function NpcRenderer({ world, npcs, cameraPosition, enabled = true }: NpcRendererProps) {
  const { scene, camera } = useThree();
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

  // Update text sprites to face camera (billboard effect)
  useFrame(() => {
    if (!enabled || loadedNpcsRef.current.size === 0) return;

    const cameraPos = cameraPosition || (camera ? camera.position : undefined);
    if (!cameraPos) return;

    // Update all text sprites to face camera
    for (const npcGroup of loadedNpcsRef.current.values()) {
      // Find sprite in group (should be the second child after box)
      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (sprite) {
        // Make sprite face camera
        sprite.lookAt(cameraPos);
      }
    }
  });

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
      }

      // Unload distant NPCs
      for (const npcId of toUnload) {
        const npcGroup = loadedNpcsRef.current.get(npcId);
        if (npcGroup && npcsGroupRef.current) {
          npcsGroupRef.current.remove(npcGroup);
          disposeObject3D(npcGroup);
          loadedNpcsRef.current.delete(npcId);
        }
      }
    }
  };

  // Streaming update via useFrame
  useFrame(() => {
    if (allNpcsRef.current.length > 0) {
      updateNpcStreaming();
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (npcsGroupRef.current) {
        scene.remove(npcsGroupRef.current);
        // Dispose all NPCs
        for (const npcGroup of loadedNpcsRef.current.values()) {
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
