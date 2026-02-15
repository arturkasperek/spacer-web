import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWorldTime } from "./world-time";

export function getWorldLightFactor(hour: number, minute: number): number {
  const mins = (((hour % 24) + 24) % 24) * 60 + (((minute % 60) + 60) % 60);
  const dayFrac = mins / 1440;
  // Same elevation curve as sky.tsx (sun on horizon at 06:00/18:00).
  const elev = Math.sin((dayFrac - 0.25) * Math.PI * 2);
  const sun01 = Math.max(0, elev);
  const nightFloor = 0.28; // keep a little ambient at night
  const factor = nightFloor + (1 - nightFloor) * Math.pow(sun01, 0.85);
  return Math.min(1, Math.max(0.05, factor));
}

const applyFactorToMaterial = (material: THREE.Material, factor: number) => {
  const m: any = material as any;
  if (!m?.isMeshBasicMaterial) return;
  if (!m.color || typeof m.color.copy !== "function") return;
  if (!m.userData) m.userData = {};

  if (!m.userData.__baseColor) {
    m.userData.__baseColor = m.color.clone();
  }

  m.color.copy(m.userData.__baseColor).multiplyScalar(factor);
};

export function WorldTimeLighting() {
  const { scene } = useThree();
  const t = useWorldTime();

  useEffect(() => {
    const factor = getWorldLightFactor(t.hour, t.minute);
    scene.traverse((o) => {
      const mat: any = (o as any).material;
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) applyFactorToMaterial(m, factor);
      } else {
        applyFactorToMaterial(mat, factor);
      }
    });
  }, [scene, t.hour, t.minute]);

  return null;
}
