import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World, Vob } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, getItemsToLoadUnload, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';

interface NpcRendererProps {
  world: World | null;
  npcs: Map<number, NpcData>;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
}

// Helper to create a stable key from Map for React dependencies
function getMapKey(npcs: Map<number, NpcData>): string {
  const entries = Array.from(npcs.entries());
  entries.sort((a, b) => a[0] - b[0]); // Sort by instance index
  return entries.map(([idx, data]) => `${idx}:${data.spawnpoint}`).join('|');
}

/**
 * Recursively search for a VOB by name in the VOB tree
 */
function findVobByName(vob: Vob, name: string): Vob | null {
  // Check if this VOB matches
  if (vob.name && vob.name === name) {
    return vob;
  }

  // Search children recursively
  const childCount = vob.children.size();
  for (let i = 0; i < childCount; i++) {
    const child = vob.children.get(i);
    const found = findVobByName(child, name);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Create a text sprite for NPC name label
 */
function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not get 2D context');
  }

  // Set canvas size
  canvas.width = 256;
  canvas.height = 64;

  // Draw text with outline
  const fontSize = 32;
  context.font = `bold ${fontSize}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  // Draw outline (black)
  context.strokeStyle = '#000000';
  context.lineWidth = 4;
  context.strokeText(text, canvas.width / 2, canvas.height / 2);

  // Draw text (white)
  context.fillStyle = '#ffffff';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  // Create texture from canvas
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  // Create sprite material
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
  });

  // Create sprite
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(100, 25, 1); // Scale to appropriate size
  sprite.position.y = 35; // Position above box

  return sprite;
}

/**
 * Create NPC mesh (box + text sprite) imperatively
 */
function createNpcMesh(npcData: NpcData, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(position);

  // Create green box
  const boxGeometry = new THREE.BoxGeometry(30, 50, 30);
  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
  });
  const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
  group.add(boxMesh);

  // Create text sprite
  const displayName = npcData.name || npcData.symbolName;
  try {
    const textSprite = createTextSprite(displayName);
    group.add(textSprite);
  } catch (error) {
    console.warn(`Failed to create text sprite for NPC ${displayName}:`, error);
  }

  // Store NPC data in userData
  group.userData.npcData = npcData;
  group.userData.isNpc = true;

  return group;
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
 * 
 * Spawnpoint lookup order (matching original engine):
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

    for (const [, npcData] of npcs.entries()) {
      let position: [number, number, number] | null = null;

      // First, try to find waypoint by name (matching original engine behavior)
      const wpResult = world.findWaypointByName(npcData.spawnpoint);

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
          const foundVob = findVobByName(rootVob, npcData.spawnpoint);

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
        console.warn(`⚠️ Could not find spawnpoint "${npcData.spawnpoint}" (waypoint or VOB) for NPC ${npcData.symbolName}`);
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
