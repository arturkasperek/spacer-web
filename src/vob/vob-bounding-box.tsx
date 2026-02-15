import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

interface VOBBoundingBoxProps {
  readonly vobObject: THREE.Object3D | null;
  readonly visible?: boolean;
  readonly color?: string;
  readonly lineWidth?: number;
}

/**
 * Renders a 3D bounding box around a VOB object
 */
export function VOBBoundingBox({
  vobObject,
  visible = true,
  color = "#00ff00",
  lineWidth = 5,
}: VOBBoundingBoxProps) {
  const boxRef = useRef<THREE.Group>(null);

  // Create line material with proper thickness support
  const lineMaterial = useMemo(() => {
    const material = new LineMaterial({
      color: color,
      linewidth: lineWidth,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);
    return material;
  }, [color, lineWidth]);

  // Create 12 separate line segments (one for each edge)
  const lineSegments = useMemo(() => {
    const half = 0.5;
    const segments: Line2[] = [];

    // Define 12 edges as separate line segments
    const edges = [
      // Bottom face (z = -0.5) - 4 edges
      [
        [-half, -half, -half],
        [half, -half, -half],
      ], // edge 1: bottom front
      [
        [half, -half, -half],
        [half, half, -half],
      ], // edge 2: bottom right
      [
        [half, half, -half],
        [-half, half, -half],
      ], // edge 3: bottom back
      [
        [-half, half, -half],
        [-half, -half, -half],
      ], // edge 4: bottom left

      // Top face (z = +0.5) - 4 edges
      [
        [-half, -half, half],
        [half, -half, half],
      ], // edge 5: top front
      [
        [half, -half, half],
        [half, half, half],
      ], // edge 6: top right
      [
        [half, half, half],
        [-half, half, half],
      ], // edge 7: top back
      [
        [-half, half, half],
        [-half, -half, half],
      ], // edge 8: top left

      // Vertical edges - 4 edges connecting bottom to top
      [
        [-half, -half, -half],
        [-half, -half, half],
      ], // edge 9: front-left vertical
      [
        [half, -half, -half],
        [half, -half, half],
      ], // edge 10: front-right vertical
      [
        [half, half, -half],
        [half, half, half],
      ], // edge 11: back-right vertical
      [
        [-half, half, -half],
        [-half, half, half],
      ], // edge 12: back-left vertical
    ];

    for (const [start, end] of edges) {
      const positions = [...start, ...end];
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const line = new Line2(geometry, lineMaterial);
      segments.push(line);
    }

    return segments;
  }, [lineMaterial]);

  // Update material resolution when window resizes
  useEffect(() => {
    const updateResolution = () => {
      lineMaterial.resolution.set(window.innerWidth, window.innerHeight);
    };

    updateResolution();
    window.addEventListener("resize", updateResolution);
    return () => window.removeEventListener("resize", updateResolution);
  }, [lineMaterial]);

  // Create group to hold all line segments
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!groupRef.current) {
      const group = new THREE.Group();
      for (const segment of lineSegments) {
        group.add(segment);
      }
      groupRef.current = group;
    }
    boxRef.current = groupRef.current;

    return () => {
      if (groupRef.current) {
        for (const segment of lineSegments) {
          segment.geometry.dispose();
          if (segment.material instanceof LineMaterial) {
            segment.material.dispose();
          }
        }
      }
    };
  }, [lineSegments]);

  useFrame(() => {
    if (!vobObject || !boxRef.current || !visible) {
      if (boxRef.current) {
        boxRef.current.visible = false;
      }
      return;
    }

    // Compute bounding box of the VOB object
    const box = new THREE.Box3();
    box.setFromObject(vobObject);

    if (box.isEmpty()) {
      if (boxRef.current) {
        boxRef.current.visible = false;
      }
      return;
    }

    // Get center and size
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Update the bounding box position and scale
    boxRef.current.position.copy(center);
    boxRef.current.scale.set(size.x, size.y, size.z);
    boxRef.current.visible = true;
  });

  useEffect(() => {
    lineMaterial.color.set(color);
  }, [color, lineMaterial]);

  if (!visible || !vobObject) {
    return null;
  }

  return boxRef.current ? <primitive object={boxRef.current} /> : null;
}
