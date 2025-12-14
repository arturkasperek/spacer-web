import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, getItemsToLoadUnload, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { findActiveRoutineWaypoint, getMapKey, createNpcMesh } from './npc-utils';
import { findVobByName } from './vob-utils';
import { createHumanCharacterInstance, type CharacterCaches, type CharacterInstance } from './character/human-character.js';
import { buildWaynetGraph, findNearestWaypointIndex, findRouteAStar, findWaypointIndexByName, type WaynetGraph, type WaynetWaypoint, type WaynetEdge } from './waynet-pathfinding';

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
  const { scene, camera } = useThree();
  const npcsGroupRef = useRef<THREE.Group>(null);
  const characterCachesRef = useRef<CharacterCaches>({
    binary: new Map(),
    textures: new Map(),
    materials: new Map(),
    animations: new Map(),
  });

  // Distance-based streaming
  const loadedNpcsRef = useRef(new Map<string, THREE.Group>()); // npc id -> THREE.Group
  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3 }>>([]); // All NPC data
  const activeScriptMovesRef = useRef(
    new Map<
      string,
      {
        route: THREE.Vector3[];
        nextIndex: number;
        speed: number;
        arriveDistance: number;
        done: boolean;
      }
    >()
  );
  const waynetGraphRef = useRef<WaynetGraph | null>(null);
  const laresMoveStartedRef = useRef(false);
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

  useEffect(() => {
    waynetGraphRef.current = null;
    laresMoveStartedRef.current = false;
    activeScriptMovesRef.current.clear();
  }, [world]);

  const ensureWaynetGraph = (): WaynetGraph | null => {
    if (!world) return null;
    if (waynetGraphRef.current) return waynetGraphRef.current;

    try {
      const waypointsVector = world.getAllWaypoints() as any;
      const waypoints: WaynetWaypoint[] = [];
      const waypointCount = waypointsVector.size();
      for (let i = 0; i < waypointCount; i++) {
        const wp = waypointsVector.get(i);
        if (!wp) continue;
        waypoints.push({
          name: wp.name,
          position: {
            x: -wp.position.x,
            y: wp.position.y,
            z: wp.position.z,
          },
        });
      }

      const edges: WaynetEdge[] = [];
      const edgeCount = world.getWaypointEdgeCount();
      for (let i = 0; i < edgeCount; i++) {
        const edgeResult = world.getWaypointEdge(i);
        if (edgeResult.success && edgeResult.data) {
          edges.push(edgeResult.data);
        }
      }

      waynetGraphRef.current = buildWaynetGraph(waypoints, edges);
      return waynetGraphRef.current;
    } catch (error) {
      console.warn('[NPC] Failed to build waynet graph:', error);
      return null;
    }
  };

  const startMoveToWaypointOnce = (npcId: string, npcGroup: THREE.Group, targetWaypointName: string) => {
    if (!world) return;
    if (activeScriptMovesRef.current.has(npcId)) return;

    const graph = ensureWaynetGraph();
    if (!graph) return;

    const startIndex = findNearestWaypointIndex(graph, { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z });
    const goalIndex = findWaypointIndexByName(graph, targetWaypointName);
    const routeIdx = findRouteAStar(graph, startIndex, goalIndex);
    if (routeIdx.length < 2) {
      console.warn(`[NPC] No route for ${npcId} to ${targetWaypointName}`);
      return;
    }

    const route = routeIdx.map(i => {
      const p = graph.waypoints[i].position;
      return new THREE.Vector3(p.x, p.y, p.z);
    });

    // Future: extend with wall/chasm avoidance + special actions (jump, ladder interaction).
    npcGroup.userData.isScriptControlled = true;
    activeScriptMovesRef.current.set(npcId, {
      route,
      nextIndex: 1,
      speed: 140,
      arriveDistance: 5,
      done: false,
    });
  };

  const loadNpcCharacter = async (npcGroup: THREE.Group, npcData: NpcData) => {
    if (!zenKit) return;
    const visual = npcData.visual;
    const visualKey = visual
      ? `${visual.bodyMesh}|${visual.bodyTex}|${visual.skin}|${visual.headMesh}|${visual.headTex}|${visual.teethTex}|${visual.armorInst}`
      : 'default';

    if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey === visualKey) return;
    if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey !== visualKey) {
      const existing = npcGroup.userData.characterInstance as CharacterInstance;
      existing.dispose();
      npcGroup.userData.characterInstance = null;
    }

    npcGroup.userData.modelLoading = true;
    npcGroup.userData.visualKey = visualKey;

    try {
      const instance = await createHumanCharacterInstance({
        zenKit,
        caches: characterCachesRef.current,
        parent: npcGroup,
        animationName: 't_dance_01',
        loop: true,
        mirrorX: true,
        rootMotionTarget: "self",
        applyRootMotion: false,
        align: 'ground',
        bodyMesh: visual?.bodyMesh,
        bodyTex: visual?.bodyTex,
        skin: visual?.skin,
        headMesh: visual?.headMesh,
        headTex: visual?.headTex,
        teethTex: visual?.teethTex,
        armorInst: visual?.armorInst,
      });
      if (npcGroup.userData.isDisposed) return;

      if (!instance) {
        console.warn(`Failed to create NPC character model for ${npcData.symbolName}`);
        return;
      }

      npcGroup.userData.characterInstance = instance;
      (npcGroup.userData.characterInstance as CharacterInstance).update(0);
      if (npcGroup.userData.isDisposed) return;

      // One-shot scripted movement test: move Lares to a specific waypoint.
      // Later we can generalize this and hook it to VM/AI routines.
      const npcId = `npc-${npcData.instanceIndex}`;
      const isLares = (npcData.symbolName || '').trim().toUpperCase() === 'LARES' || (npcData.name || '').trim().toLowerCase() === 'lares';
      if (isLares && !laresMoveStartedRef.current) {
        laresMoveStartedRef.current = true;
        startMoveToWaypointOnce(npcId, npcGroup, 'NW_CITY_PATH_HABOUR_04');
      }

      const placeholder = npcGroup.getObjectByName('npc-placeholder');
      if (placeholder) {
        npcGroup.remove(placeholder);
        disposeObject3D(placeholder);
      }

      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      const modelObj = instance.object;
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
        const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
        if (instance) instance.dispose();
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
          const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
          const isLoading = Boolean(npcGroup.userData.modelLoading);
          if (instance && !isLoading) instance.dispose();
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

    const tmpToTarget = new THREE.Vector3();
    const tmpToTargetHoriz = new THREE.Vector3();
    const tmpDesiredQuat = new THREE.Quaternion();
    const tmpUp = new THREE.Vector3(0, 1, 0);
    const TURN_SPEED = 10;

    for (const npcGroup of loadedNpcsRef.current.values()) {
      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (sprite) {
        sprite.lookAt(cameraPos);
      }

      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      if (instance) {
        instance.update(delta);
      }

      const npcData = npcGroup.userData.npcData as NpcData | undefined;
      if (!npcData) continue;
      const npcId = `npc-${npcData.instanceIndex}`;
      const move = activeScriptMovesRef.current.get(npcId);
      const isMoving = Boolean(move && !move.done);

      if (instance) {
        const desired = isMoving ? "s_WalkL" : "t_dance_01";
        if (npcGroup.userData.desiredAnimation !== desired) {
          npcGroup.userData.desiredAnimation = desired;
          instance.setAnimation(desired, {
            loop: true,
            resetTime: true,
            fallbackNames: isMoving ? ["s_Walk", "s_Run"] : undefined,
          });
        }
      }

      if (move && !move.done) {
        const target = move.route[move.nextIndex];
        if (target) {
          tmpToTarget.subVectors(target, npcGroup.position);
          const dist = tmpToTarget.length();

          if (dist > 0) {
            tmpToTargetHoriz.copy(tmpToTarget);
            tmpToTargetHoriz.y = 0;
            const yaw = Math.atan2(tmpToTargetHoriz.x, tmpToTargetHoriz.z);
            tmpDesiredQuat.setFromAxisAngle(tmpUp, yaw);
            const t = 1 - Math.exp(-TURN_SPEED * delta);
            npcGroup.quaternion.slerp(tmpDesiredQuat, t);
          }

          if (dist > 0) {
            const maxStep = move.speed * delta;
            const shouldSnap = dist <= Math.max(move.arriveDistance, maxStep);

            if (shouldSnap) {
              npcGroup.position.copy(target);
              move.nextIndex += 1;
              if (move.nextIndex >= move.route.length) {
                move.done = true;
                npcGroup.userData.isScriptControlled = true;
              }
            } else {
              tmpToTarget.multiplyScalar(1 / dist);
              npcGroup.position.addScaledVector(tmpToTarget, maxStep);
            }

            // Keep the streaming source of truth updated so we don't snap back.
            const entry = allNpcsRef.current.find(n => n.npcData.instanceIndex === npcData.instanceIndex);
            if (entry) entry.position.copy(npcGroup.position);
          }
        }
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
          const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
          const isLoading = Boolean(npcGroup.userData.modelLoading);
          if (instance && !isLoading) instance.dispose();
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
