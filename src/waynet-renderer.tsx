import { useRef, useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { World, ZenKit, WayPointData, WayEdgeData } from '@kolarz3/zenkit';
import { getMeshPath } from './vob-utils';
import { loadMeshCached, buildThreeJSGeometryAndMaterials } from './mesh-utils';

interface WaynetRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  enabled?: boolean;
}

/**
 * WaynetRenderer Component - renders waypoint network (waypoints and edges)
 * 
 * Features:
 * - Renders waypoints with their visual meshes (if available) or colored spheres as fallback
 * - Renders waypoint edges as lines connecting waypoints
 * - Differentiates between free points and regular waypoints
 */
export function WaynetRenderer({ world, zenKit, enabled = true }: WaynetRendererProps) {
  const { scene } = useThree();
  const waypointsGroupRef = useRef<THREE.Group>(null);
  const edgesGroupRef = useRef<THREE.Group>(null);
  const hasLoadedRef = useRef(false);
  
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
      console.error('Failed to load waynet data:', error);
      return { waypoints: [], edges: [] };
    }
  }, [world, enabled]);

  useEffect(() => {
    if (!enabled || !world || hasLoadedRef.current) return;
    
    hasLoadedRef.current = true;
    console.log(`Waynet: Loaded ${waynetData.waypoints.length} waypoints and ${waynetData.edges.length} edges`);
  }, [world, enabled, waynetData]);

  // Load waypoint visual mesh once (shared by all waypoints)
  const waypointVisualTemplateRef = useRef<THREE.Mesh | null>(null);
  
  const loadWaypointVisualTemplate = async (): Promise<THREE.Mesh | null> => {
    if (waypointVisualTemplateRef.current) {
      return waypointVisualTemplateRef.current;
    }
    
    if (!zenKit) return null;
    
    try {
      // Waypoints use the helper visual INVISIBLE_ZCVOBWAYPOINT.MRM
      const visualName = 'INVISIBLE_ZCVOBWAYPOINT.MRM';
      
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
        materialCacheRef.current
      );
      
      if (!geometry || geometry.attributes.position === undefined || geometry.attributes.position.count === 0) {
        return null;
      }
      
      // Create template mesh (we'll clone this for each waypoint)
      const templateMesh = new THREE.Mesh(geometry, materials);
      waypointVisualTemplateRef.current = templateMesh;
      
      return templateMesh;
    } catch (error) {
      console.warn(`Failed to load waypoint visual template:`, error);
      return null;
    }
  };
  
  // Create a waypoint mesh instance from the template with icon
  const createWaypointMesh = (wp: WayPointData, index: number): THREE.Group => {
    const group = new THREE.Group();
    group.position.set(-wp.position.x, wp.position.y, wp.position.z);
    group.userData.waypointName = wp.name;
    group.userData.freePoint = wp.free_point;
    group.userData.waypointIndex = index;
    
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
      freePoint: wp.free_point,
      underWater: wp.under_water,
      waterDepth: wp.water_depth,
      isIcon: true,
    };
    
    group.add(iconSphere);
    return group;
  };

  // Create waypoint meshes (visuals or spheres as fallback)
  const [waypointMeshes, setWaypointMeshes] = useState<THREE.Group | null>(null);
  
  useEffect(() => {
    if (!enabled || waynetData.waypoints.length === 0 || !zenKit) {
      setWaypointMeshes(null);
      return;
    }

    const waypointsGroup = new THREE.Group();
    waypointsGroup.name = 'Waypoints';

    const loadWaypoints = async () => {
      // Load the visual template once (shared by all waypoints)
      await loadWaypointVisualTemplate();
      
      // Create waypoint meshes using the template (or fallback spheres)
      waynetData.waypoints.forEach((wp: WayPointData, index: number) => {
        const mesh = createWaypointMesh(wp, index);
        waypointsGroup.add(mesh);
      });
      
      setWaypointMeshes(waypointsGroup);
    };

    loadWaypoints();
  }, [waynetData.waypoints, enabled, zenKit]);

  // Create edge lines
  const edgeLines = useMemo(() => {
    if (!enabled || waynetData.edges.length === 0 || waynetData.waypoints.length === 0) return null;

    const edgesGroup = new THREE.Group();
    edgesGroup.name = 'WaypointEdges';

    // Create a single geometry for all edges (more efficient)
    const positions: number[] = [];
    
    waynetData.edges.forEach((edge: WayEdgeData) => {
      const wpA = waynetData.waypoints[edge.waypoint_a_index];
      const wpB = waynetData.waypoints[edge.waypoint_b_index];
      
      if (!wpA || !wpB) return; // Skip invalid edges
      
      // Add line segment (Gothic coordinate system conversion)
      positions.push(
        -wpA.position.x, wpA.position.y, wpA.position.z,
        -wpB.position.x, wpB.position.y, wpB.position.z,
      );
    });

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
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

  // Add/remove waypoints and edges from scene
  useEffect(() => {
    if (!enabled) {
      // Remove from scene if disabled
      if (waypointsGroupRef.current) {
        scene.remove(waypointsGroupRef.current);
        waypointsGroupRef.current = null;
      }
      if (edgesGroupRef.current) {
        scene.remove(edgesGroupRef.current);
        edgesGroupRef.current = null;
      }
      return;
    }

    // Add waypoints to scene
    if (waypointMeshes && waypointsGroupRef.current !== waypointMeshes) {
      if (waypointsGroupRef.current) {
        scene.remove(waypointsGroupRef.current);
      }
      scene.add(waypointMeshes);
      waypointsGroupRef.current = waypointMeshes;
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
      if (waypointsGroupRef.current) {
        scene.remove(waypointsGroupRef.current);
        waypointsGroupRef.current = null;
      }
      if (edgesGroupRef.current) {
        scene.remove(edgesGroupRef.current);
        edgesGroupRef.current = null;
      }
    };
  }, [scene, waypointMeshes, edgeLines, enabled]);

  // Component doesn't render anything directly (uses imperative scene manipulation)
  return null;
}

