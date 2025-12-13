// NPC utility functions for routine processing and mesh creation
import * as THREE from "three";
import type { NpcData, RoutineEntry } from './types';
import { createTextSprite } from './mesh-utils';

/**
 * Find the active routine entry at a given time (hour:minute)
 * Returns the waypoint name from the active routine, or null if no routine is active
 */
export function findActiveRoutineWaypoint(routines: RoutineEntry[] | undefined, hour: number, minute: number = 0): string | null {
  if (!routines || routines.length === 0) {
    return null;
  }

  // Convert current time to minutes since midnight for easier comparison
  const currentTime = hour * 60 + minute;

  for (const routine of routines) {
    const startM = (routine.start_h * 60) + (routine.start_m ?? 0);
    const stopM = (routine.stop_h * 60) + (routine.stop_m ?? 0);

    let isActive = false;

    // Handle routines that wrap around midnight (end < start)
    if (stopM < startM) {
      // Routine wraps: active if currentTime >= startM OR currentTime < stopM
      isActive = currentTime >= startM || currentTime < stopM;
    } else {
      // Normal routine: active if startM <= currentTime < stopM
      isActive = currentTime >= startM && currentTime < stopM;
    }

    if (isActive && routine.waypoint) {
      return routine.waypoint;
    }
  }

  return null;
}

/**
 * Helper to create a stable key from Map for React dependencies
 */
export function getMapKey(npcs: Map<number, NpcData>): string {
  const entries = Array.from(npcs.entries());
  entries.sort((a, b) => a[0] - b[0]); // Sort by instance index
  return entries.map(([idx, data]) => `${idx}:${data.spawnpoint}`).join('|');
}

/**
 * Create NPC mesh (box + text sprite) imperatively
 */
export function createNpcMesh(npcData: NpcData, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(position);

  // Placeholder while real model loads
  const boxGeometry = new THREE.BoxGeometry(20, 60, 20);
  const boxMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.25,
  });
  const placeholder = new THREE.Mesh(boxGeometry, boxMaterial);
  placeholder.name = 'npc-placeholder';
  placeholder.position.y = 30;
  group.add(placeholder);

  // Create text sprite
  const displayName = npcData.name || npcData.symbolName;
  try {
    const textSprite = createTextSprite(displayName);
    textSprite.position.y = 120;
    group.add(textSprite);
  } catch (error) {
    console.warn(`Failed to create text sprite for NPC ${displayName}:`, error);
  }

  // Store NPC data in userData
  group.userData.npcData = npcData;
  group.userData.isNpc = true;

  return group;
}
