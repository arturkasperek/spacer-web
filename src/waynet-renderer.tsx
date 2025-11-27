import { useRef, useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { World, WayPointData, WayEdgeData } from '@kolarz3/zenkit';

interface WaynetRendererProps {
  world: World | null;
  enabled?: boolean;
}

/**
 * WaynetRenderer Component - renders waypoint network (waypoints and edges)
 * 
 * Features:
 * - Renders waypoints as colored spheres (blue for regular, orange for free points)
 * - Renders waypoint edges as lines connecting waypoints
 * - Differentiates between free points and regular waypoints
 */
export function WaynetRenderer({ world, enabled = true }: WaynetRendererProps) {
  const { scene } = useThree();
  const waypointsGroupRef = useRef<THREE.Group>(null);
  const edgesGroupRef = useRef<THREE.Group>(null);
  const hasLoadedRef = useRef(false);

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

  // Create waypoint spheres
  const waypointMeshes = useMemo(() => {
    if (!enabled || waynetData.waypoints.length === 0) return null;

    const waypointsGroup = new THREE.Group();
    waypointsGroup.name = 'Waypoints';

    waynetData.waypoints.forEach((wp: WayPointData, index: number) => {
      // Different colors for free points vs regular waypoints
      const color = wp.free_point ? 0xff8800 : 0x0088ff; // Orange for free points, blue for regular
      const radius = wp.free_point ? 15 : 10; // Slightly larger for free points
      
      const geometry = new THREE.SphereGeometry(radius, 8, 8);
      const material = new THREE.MeshBasicMaterial({ 
        color,
        transparent: true,
        opacity: 0.7,
      });
      
      const sphere = new THREE.Mesh(geometry, material);
      
      // Convert position (Gothic uses different coordinate system)
      sphere.position.set(-wp.position.x, wp.position.y, wp.position.z);
      sphere.userData = {
        waypointIndex: index,
        waypointName: wp.name,
        freePoint: wp.free_point,
        underWater: wp.under_water,
        waterDepth: wp.water_depth,
      };
      
      waypointsGroup.add(sphere);
    });

    return waypointsGroup;
  }, [waynetData.waypoints, enabled]);

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

