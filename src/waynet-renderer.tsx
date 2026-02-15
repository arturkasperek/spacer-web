import { useRef, useEffect, useMemo, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World, ZenKit, WayPointData, WayEdgeData } from "@kolarz3/zenkit";
import { getMeshPath } from "./vob-utils";
import { loadMeshCached, buildThreeJSGeometryAndMaterials } from "./mesh-utils";
import {
  createStreamingState,
  shouldUpdateStreaming,
  getItemsToLoadUnload,
  disposeObject3D,
} from "./distance-streaming";
import { VOBBoundingBox } from "./vob-bounding-box";

interface WaynetRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
  selectedWaypoint?: WayPointData | null;
}

/**
 * WaynetRenderer Component - renders waypoint network (waypoints and edges)
 *
 * Features:
 * - Renders waypoints with their visual meshes (if available) or colored spheres as fallback
 * - Renders waypoint edges as lines connecting waypoints
 * - Differentiates between free points and regular waypoints
 */
export function WaynetRenderer({
  world,
  zenKit,
  cameraPosition,
  enabled = true,
  selectedWaypoint,
}: WaynetRendererProps) {
  const { scene } = useThree();
  const waypointsGroupRef = useRef<THREE.Group>(null);
  const edgesGroupRef = useRef<THREE.Group>(null);
  const hasLoadedRef = useRef(false);
  const [selectedWaypointObject, setSelectedWaypointObject] = useState<THREE.Object3D | null>(null);

  // Distance-based streaming
  const loadedWaypointsRef = useRef(new Map<string, THREE.Group>()); // waypoint name -> THREE.Group
  const allWaypointsRef = useRef<WayPointData[]>([]); // All waypoint data
  const WAYPOINT_LOAD_DISTANCE = 5000; // Load waypoints within this distance
  const WAYPOINT_UNLOAD_DISTANCE = 6000; // Unload waypoints beyond this distance

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

  // Caches for waypoint mesh rendering
  const meshCacheRef = useRef(new Map<string, any>());
  const textureCacheRef = useRef(new Map<string, THREE.DataTexture>());
  const materialCacheRef = useRef(new Map<string, THREE.Material>());

  // Load waypoints and edges from world
  const waynetData = useMemo(() => {
    if (!world || !enabled) {
      return { waypoints: [], edges: [] };
    }

    try {
      // Get all waypoints - getAllWaypoints() returns an Emscripten vector, not a plain array
      const waypointsVector = world.getAllWaypoints() as any;
      const waypoints: WayPointData[] = [];

      // Convert Emscripten vector to array
      // Emscripten vectors have .size() and .get() methods
      const waypointCount = waypointsVector.size();
      for (let i = 0; i < waypointCount; i++) {
        const wp = waypointsVector.get(i);
        if (wp) {
          waypoints.push(wp);
        }
      }

      // Get all edges
      const edges: WayEdgeData[] = [];
      const edgeCount = world.getWaypointEdgeCount();
      for (let i = 0; i < edgeCount; i++) {
        const edgeResult = world.getWaypointEdge(i);
        if (edgeResult.success && edgeResult.data) {
          edges.push(edgeResult.data);
        }
      }

      return { waypoints, edges };
    } catch (error) {
      console.error("Failed to load waynet data:", error);
      return { waypoints: [], edges: [] };
    }
  }, [world, enabled]);

  // When disabled, remove all waypoint visuals (and reset streaming state so re-enabling works).
  useEffect(() => {
    if (enabled) return;

    setSelectedWaypointObject(null);

    for (const mesh of loadedWaypointsRef.current.values()) {
      disposeObject3D(mesh);
    }
    loadedWaypointsRef.current.clear();

    if (waypointsGroupRef.current) {
      scene.remove(waypointsGroupRef.current);
      waypointsGroupRef.current = null;
    }

    if (edgesGroupRef.current) {
      scene.remove(edgesGroupRef.current);
      edgesGroupRef.current = null;
    }

    hasLoadedRef.current = false;
    allWaypointsRef.current = [];
    streamingState.current = createStreamingState();
  }, [enabled, scene]);

  useEffect(() => {
    if (!enabled || !world || hasLoadedRef.current) return;

    hasLoadedRef.current = true;
    // Store all waypoints for streaming
    allWaypointsRef.current = waynetData.waypoints;
    console.log(
      `Waynet: Loaded ${waynetData.waypoints.length} waypoints and ${waynetData.edges.length} edges`,
    );
  }, [world, enabled, waynetData]);

  // Load waypoint visual mesh once (shared by all waypoints)
  const waypointVisualTemplateRef = useRef<THREE.Mesh | null>(null);
  const isTemplateLoadingRef = useRef(false);
  const isTemplateLoadedRef = useRef(false);

  const loadWaypointVisualTemplate = async (): Promise<THREE.Mesh | null> => {
    if (waypointVisualTemplateRef.current) {
      return waypointVisualTemplateRef.current;
    }

    if (!zenKit) return null;

    try {
      // Waypoints use the helper visual INVISIBLE_ZCVOBWAYPOINT.MRM
      const visualName = "INVISIBLE_ZCVOBWAYPOINT.MRM";

      // Load mesh
      const meshPath = getMeshPath(visualName);
      if (!meshPath) {
        console.warn(`Could not get mesh path for waypoint visual "${visualName}"`);
        return null;
      }

      const processed = await loadMeshCached(meshPath, zenKit, meshCacheRef.current);
      if (!processed) return null;

      // Build geometry and materials
      const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
        processed,
        zenKit,
        textureCacheRef.current,
        materialCacheRef.current,
      );

      if (
        !geometry ||
        geometry.attributes.position === undefined ||
        geometry.attributes.position.count === 0
      ) {
        return null;
      }

      // Create template mesh (we'll clone this for each waypoint)
      const templateMesh = new THREE.Mesh(geometry, materials);
      waypointVisualTemplateRef.current = templateMesh;
      isTemplateLoadedRef.current = true;

      return templateMesh;
    } catch (error) {
      console.warn(`Failed to load waypoint visual template:`, error);
      isTemplateLoadedRef.current = true; // Mark as loaded even on failure so we don't block forever
      return null;
    }
  };

  // Create a waypoint mesh instance from the template with icon
  const createWaypointMesh = (wp: WayPointData, index: number): THREE.Group => {
    const group = new THREE.Group();
    group.position.set(-wp.position.x, wp.position.y, wp.position.z);
    group.userData.waypointName = wp.name;
    group.userData.waypoint = wp;
    group.userData.freePoint = wp.free_point;
    group.userData.waypointIndex = index;

    // Apply rotation from direction vector
    if (wp.direction && (wp.direction.x !== 0 || wp.direction.y !== 0 || wp.direction.z !== 0)) {
      // Convert Gothic direction to Three.js world space (flip X)
      const direction = new THREE.Vector3(-wp.direction.x, wp.direction.y, wp.direction.z);

      // Create a quaternion from the direction vector
      // We assume the direction is the forward direction (negative Z in Three.js)
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion();

      // Create a matrix that looks along the direction
      const matrix = new THREE.Matrix4();
      matrix.lookAt(new THREE.Vector3(0, 0, 0), direction, up);
      quaternion.setFromRotationMatrix(matrix);

      // Apply 180-degree rotation around Y axis to correct orientation
      const yRotation = new THREE.Quaternion();
      yRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      quaternion.multiply(yRotation);

      group.quaternion.copy(quaternion);
    }

    // Add visual mesh if template is loaded
    const template = waypointVisualTemplateRef.current;
    if (template) {
      const visualMesh = template.clone();
      visualMesh.position.set(0, 0, 0); // Position relative to group
      group.add(visualMesh);
    }

    // Always add colored icon/sphere on top
    const color = wp.free_point ? 0xff8800 : 0x0088ff; // Orange for free points, blue for regular
    const radius = wp.free_point ? 15 : 10;

    const geometry = new THREE.SphereGeometry(radius, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
    });

    const iconSphere = new THREE.Mesh(geometry, material);
    iconSphere.position.set(0, 0, 0); // Position relative to group
    iconSphere.userData = {
      waypointIndex: index,
      waypointName: wp.name,
      waypoint: wp,
      freePoint: wp.free_point,
      underWater: wp.under_water,
      waterDepth: wp.water_depth,
      isIcon: true,
    };

    group.add(iconSphere);
    return group;
  };

  // Streaming waypoint loader - loads/unloads based on camera distance
  const updateWaypointStreaming = () => {
    // Wait for template to load before creating waypoints
    if (
      !enabled ||
      allWaypointsRef.current.length === 0 ||
      !zenKit ||
      !isTemplateLoadedRef.current
    ) {
      return;
    }

    const config = {
      loadDistance: WAYPOINT_LOAD_DISTANCE,
      unloadDistance: WAYPOINT_UNLOAD_DISTANCE,
      updateThreshold: 100,
      updateInterval: 10,
    };

    // Use the Three.js camera position directly if cameraPosition prop is not provided or is at origin
    const { camera } = scene as any;
    const effectiveCameraPos = cameraPosition || (camera ? camera.position : undefined);

    const { shouldUpdate, cameraPos } = shouldUpdateStreaming(
      streamingState.current,
      effectiveCameraPos,
      config,
    );

    if (shouldUpdate) {
      // Convert waypoints to streamable items with positions for distance checking
      const waypointItems = allWaypointsRef.current.map((wp) => ({
        id: wp.name,
        position: new THREE.Vector3(-wp.position.x, wp.position.y, wp.position.z),
      }));

      // Find waypoints to load/unload using shared utility
      const { toLoad, toUnload } = getItemsToLoadUnload(
        waypointItems,
        cameraPos,
        config,
        loadedWaypointsRef.current,
      );

      // Load new waypoints
      for (const item of toLoad) {
        const wp = allWaypointsRef.current.find((w) => w.name === item.id);
        if (!wp) continue;

        const waypointMesh = createWaypointMesh(wp, allWaypointsRef.current.indexOf(wp));
        loadedWaypointsRef.current.set(wp.name, waypointMesh);

        // Ensure waypoints group exists
        if (!waypointsGroupRef.current) {
          const group = new THREE.Group();
          group.name = "Waypoints";
          waypointsGroupRef.current = group;
          scene.add(group);
        }
        waypointsGroupRef.current.add(waypointMesh);
      }

      // Unload distant waypoints
      for (const wpName of toUnload) {
        if (selectedWaypoint?.name && wpName === selectedWaypoint.name) {
          continue; // keep selected waypoint loaded for selection/bounding box
        }
        const mesh = loadedWaypointsRef.current.get(wpName);
        if (mesh && waypointsGroupRef.current) {
          waypointsGroupRef.current.remove(mesh);
          disposeObject3D(mesh);
          loadedWaypointsRef.current.delete(wpName);
        }
      }
    }
  };

  // Load waypoint visual template on mount
  useEffect(() => {
    if (!enabled || !zenKit || isTemplateLoadingRef.current) return;

    isTemplateLoadingRef.current = true;

    loadWaypointVisualTemplate().then((template) => {
      if (template) {
        console.log("[Waynet] Waypoint visual template loaded - ready to create waypoints");
      } else {
        console.log("[Waynet] Using sphere-only waypoint rendering");
      }
    });
  }, [enabled, zenKit]);

  // Streaming update via useFrame
  useFrame(() => {
    if (hasLoadedRef.current && allWaypointsRef.current.length > 0) {
      updateWaypointStreaming();
    }
  });

  // Ensure selected waypoint is loaded and track its object for bounding box rendering
  useEffect(() => {
    if (!enabled || !world || !selectedWaypoint?.name) {
      setSelectedWaypointObject(null);
      return;
    }

    const name = selectedWaypoint.name;
    const alreadyLoaded = loadedWaypointsRef.current.get(name);
    if (alreadyLoaded) {
      setSelectedWaypointObject(alreadyLoaded);
      return;
    }

    const wp = allWaypointsRef.current.find((w) => w.name === name);
    if (!wp) {
      setSelectedWaypointObject(null);
      return;
    }

    const waypointMesh = createWaypointMesh(wp, allWaypointsRef.current.indexOf(wp));
    loadedWaypointsRef.current.set(wp.name, waypointMesh);

    if (!waypointsGroupRef.current) {
      const group = new THREE.Group();
      group.name = "Waypoints";
      waypointsGroupRef.current = group;
      scene.add(group);
    }
    waypointsGroupRef.current.add(waypointMesh);
    setSelectedWaypointObject(waypointMesh);
  }, [enabled, world, scene, selectedWaypoint?.name]);

  // Create edge lines (only for loaded waypoints)
  const edgeLines = useMemo(() => {
    if (!enabled || waynetData.edges.length === 0 || waynetData.waypoints.length === 0) return null;

    const edgesGroup = new THREE.Group();
    edgesGroup.name = "WaypointEdges";

    // Create a single geometry for all edges (more efficient)
    const positions: number[] = [];

    waynetData.edges.forEach((edge: WayEdgeData) => {
      const wpA = waynetData.waypoints[edge.waypoint_a_index];
      const wpB = waynetData.waypoints[edge.waypoint_b_index];

      if (!wpA || !wpB) return; // Skip invalid edges

      // Only render edges if both waypoints are loaded (or render all edges - simpler)
      // For now, render all edges for simplicity
      positions.push(
        -wpA.position.x,
        wpA.position.y,
        wpA.position.z,
        -wpB.position.x,
        wpB.position.y,
        wpB.position.z,
      );
    });

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x00ff88, // Brighter cyan-green for waypoint edges (more visible)
      transparent: true,
      opacity: 0.9, // Increased opacity for stronger visibility
      linewidth: 2, // Note: linewidth may not work in all browsers due to WebGL limitations
    });

    const lines = new THREE.LineSegments(geometry, material);
    edgesGroup.add(lines);

    return edgesGroup;
  }, [waynetData.edges, waynetData.waypoints, enabled]);

  // Add/remove edges from scene (waypoints are managed by streaming)
  useEffect(() => {
    if (!enabled) {
      // Remove edges if disabled
      if (edgesGroupRef.current) {
        scene.remove(edgesGroupRef.current);
        edgesGroupRef.current = null;
      }
      return;
    }

    // Add edges to scene
    if (edgeLines && edgesGroupRef.current !== edgeLines) {
      if (edgesGroupRef.current) {
        scene.remove(edgesGroupRef.current);
      }
      scene.add(edgeLines);
      edgesGroupRef.current = edgeLines;
    }

    // Cleanup on unmount
    return () => {
      if (edgesGroupRef.current) {
        scene.remove(edgesGroupRef.current);
        edgesGroupRef.current = null;
      }
      // Cleanup waypoints group
      if (waypointsGroupRef.current) {
        scene.remove(waypointsGroupRef.current);
        waypointsGroupRef.current = null;
      }
    };
  }, [scene, edgeLines, enabled]);

  return selectedWaypointObject ? (
    <VOBBoundingBox vobObject={selectedWaypointObject} visible={true} color="#ffff00" />
  ) : null;
}
