import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { World } from "@kolarz3/zenkit";
import { findActiveRoutineWaypoint } from "./npc-utils";
import { createAabbAroundPoint, type Aabb } from "./npc-routine-waybox";
import type { NpcData } from "./types";
import { normalizeNameKey } from "./npc-renderer-utils";

export function computeNpcsWithPositions({
  world,
  enabled,
  npcs,
  hour,
  minute,
  npcRoutineWayboxIndex,
  waypointPosIndex,
  vobPosIndex,
  loadedNpcsRef,
}: {
  world: World | null;
  enabled: boolean;
  npcs: Map<number, NpcData>;
  hour: number;
  minute: number;
  npcRoutineWayboxIndex: Map<number, Aabb | null>;
  waypointPosIndex: Map<string, THREE.Vector3>;
  vobPosIndex: Map<string, THREE.Vector3>;
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
}): Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }> {
  if (!world || !enabled || npcs.size === 0) {
    return [];
  }

  const renderableNpcs: Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }> = [];
  const CURRENT_HOUR = hour;
  const CURRENT_MINUTE = minute;

  for (const [, npcData] of npcs.entries()) {
    let position: [number, number, number] | null = null;
    let waypointName: string | null = null;

    const routineWaybox = npcRoutineWayboxIndex.get(npcData.instanceIndex) ?? null;

    // ZenGin-like behavior: routine-driven NPC spawning depends on routine "wayboxes" derived from
    // existing waynet waypoints. If a routine references no existing waypoint at all, the original game
    // effectively never spawns the NPC. Mimic that by not rendering it.
    if (npcData.dailyRoutine && npcData.dailyRoutine.length > 0 && !routineWaybox) continue;

    // Priority 1: Check routine waypoint at current time (10:00)
    const routineWaypoint = findActiveRoutineWaypoint(npcData.dailyRoutine, CURRENT_HOUR, CURRENT_MINUTE);
    if (routineWaypoint) {
      waypointName = routineWaypoint;
    } else {
      // Priority 2: Fall back to spawnpoint if no routine is active
      waypointName = npcData.spawnpoint;
    }

    const npcId = `npc-${npcData.instanceIndex}`;
    const loaded = loadedNpcsRef.current.get(npcId);
    if (loaded && !loaded.userData.isDisposed) {
      position = [loaded.position.x, loaded.position.y, loaded.position.z];
    } else if (waypointName) {
      const key = normalizeNameKey(waypointName);
      const wpPos = waypointPosIndex.get(key);
      if (wpPos) {
        position = [wpPos.x, wpPos.y, wpPos.z];
      } else {
        const vPos = vobPosIndex.get(key);
        if (vPos) position = [vPos.x, vPos.y, vPos.z];
      }
    }

    if (position) {
      const pos = new THREE.Vector3(position[0], position[1], position[2]);
      const waybox =
        routineWaybox ??
        createAabbAroundPoint(pos, {
          x: 1,
          y: 1,
          z: 1,
        });
      renderableNpcs.push({
        npcData,
        position: pos,
        waybox,
      });
    } else {
      const source = routineWaypoint ? `routine waypoint \"${routineWaypoint}\"` : `spawnpoint \"${npcData.spawnpoint}\"`;
      console.warn(`⚠️ Could not find ${source} (waypoint or VOB) for NPC ${npcData.symbolName}`);
    }
  }

  return renderableNpcs;
}

