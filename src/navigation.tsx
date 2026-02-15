import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import type { Mesh } from "three";

interface NavigationBoxProps {
  onCameraChange: (position: [number, number, number], lookAt: [number, number, number]) => void;
}

export function NavigationBox({ onCameraChange }: NavigationBoxProps) {
  const meshRef = useRef<Mesh>(null!);

  // Handle clicks on different faces
  const handleFaceClick = (face: string) => {
    switch (face) {
      case "front":
        onCameraChange([0, 0, 80], [0, 0, 0]);
        break;
      case "back":
        onCameraChange([0, 0, -80], [0, 0, 0]);
        break;
      case "left":
        onCameraChange([-80, 0, 0], [0, 0, 0]);
        break;
      case "right":
        onCameraChange([80, 0, 0], [0, 0, 0]);
        break;
      case "top":
        onCameraChange([0, 80, 0], [0, 0, 0]);
        break;
      case "bottom":
        onCameraChange([0, -80, 0], [0, 0, 0]);
        break;
    }
  };

  return (
    <group scale={0.5}>
      {/* Front face */}
      <mesh position={[0, 0, 0.5]} onClick={() => handleFaceClick("front")}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ff6b6b" />
      </mesh>
      {/* Back face */}
      <mesh
        position={[0, 0, -0.5]}
        rotation={[0, Math.PI, 0]}
        onClick={() => handleFaceClick("back")}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#4ecdc4" />
      </mesh>
      {/* Left face */}
      <mesh
        position={[-0.5, 0, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        onClick={() => handleFaceClick("left")}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#45b7d1" />
      </mesh>
      {/* Right face */}
      <mesh
        position={[0.5, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
        onClick={() => handleFaceClick("right")}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#f9ca24" />
      </mesh>
      {/* Top face */}
      <mesh
        position={[0, 0.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={() => handleFaceClick("top")}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#6c5ce7" />
      </mesh>
      {/* Bottom face */}
      <mesh
        position={[0, -0.5, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        onClick={() => handleFaceClick("bottom")}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#a29bfe" />
      </mesh>
      {/* Wireframe outline */}
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial wireframe color="#ffffff" />
      </mesh>
    </group>
  );
}

export function NavigationOverlay({ onCameraChange }: NavigationBoxProps) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        width: "160px",
        height: "160px",
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <Canvas
        camera={{ position: [2.5, 2.5, 2.5], fov: 50 }}
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
        }}
      >
        <NavigationBox onCameraChange={onCameraChange} />
      </Canvas>
    </div>
  );
}
