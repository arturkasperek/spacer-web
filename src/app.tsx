import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";
import { WorldRenderer } from "./world-renderer.js";
import { VOBRenderer } from "./vob-renderer.js";
import { WaynetRenderer } from "./waynet-renderer.js";
import { NpcRenderer } from "./npc-renderer.js";
import { VOBTree } from "./vob-tree.js";
import { VobClickHandler } from "./vob-click-handler.js";
import { logVobDetails } from "./vob-utils.js";
import type { World, ZenKit, Vob, WayPointData } from '@kolarz3/zenkit';
import type { NpcData, NpcSpawnCallback } from "./types.js";

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();

// Component to track camera position changes
function CameraPositionTracker({ cameraControlsRef, onPositionChange }: {
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  onPositionChange: (position: THREE.Vector3) => void;
}) {
  const lastPositionRef = useRef(new THREE.Vector3());

  useFrame(() => {
    if (cameraControlsRef.current) {
      const position = cameraControlsRef.current.getPosition();
      // Only update if position actually changed (to avoid unnecessary re-renders)
      if (!position.equals(lastPositionRef.current)) {
        lastPositionRef.current.copy(position);
        onPositionChange(position);
      }
    }
  });
  return null;
}



function Scene({ cameraControlsRef, worldPath, onLoadingStatus, world, zenKit, onWorldLoaded, cameraPosition, onCameraPositionChange, onVobStats, selectedVob, onSelectedVobBoundingBox, selectedWaypoint, onVobClickFromScene, onWaypointClickFromScene, npcs, onNpcSpawn }: Readonly<{
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  worldPath: string;
  onLoadingStatus: (status: string) => void;
  world: World | null;
  zenKit: ZenKit | null;
  onWorldLoaded: (world: World, zenKit: ZenKit) => void;
  cameraPosition: THREE.Vector3;
  onCameraPositionChange: (position: THREE.Vector3) => void;
  onVobStats: (stats: { loaded: number; total: number; queue: number; loading: number; meshCache: number; morphCache: number; textureCache: number; }) => void;
  selectedVob: Vob | null;
  onSelectedVobBoundingBox: (center: THREE.Vector3, size: THREE.Vector3) => void;
  selectedWaypoint: WayPointData | null;
  onVobClickFromScene?: (vob: Vob) => void;
  onWaypointClickFromScene?: (waypoint: WayPointData) => void;
  npcs: Map<number, NpcData>;
  onNpcSpawn: NpcSpawnCallback;
}>) {
  const { camera } = useThree();
  const didInitCameraRef = useRef(false);

  // Store the camera reference
  cameraRef.current = camera;

  // Set initial camera pose
  useEffect(() => {
    camera.rotation.order = 'YXZ';
    camera.updateProjectionMatrix();

    if (didInitCameraRef.current) return;
    const controls = cameraControlsRef.current;
    if (!controls) return;

    const pos: [number, number, number] = [-24675.45, 3322.9, -21834.6];
    const yaw = 2.4152;
    const lookAt: [number, number, number] = [
      pos[0] + -Math.sin(yaw),
      pos[1],
      pos[2] + -Math.cos(yaw),
    ];
    controls.setPose(pos, lookAt);
    didInitCameraRef.current = true;
  }, [camera, cameraControlsRef]);

  return (
    <>
      <CameraControls ref={cameraControlsRef} />

      <AxesHelper />

      <SkyComponent />

      {/* World Renderer */}
      <WorldRenderer worldPath={worldPath} onLoadingStatus={onLoadingStatus} onWorldLoaded={onWorldLoaded} onNpcSpawn={onNpcSpawn} />

      {/* Camera position tracker */}
      <CameraPositionTracker
        cameraControlsRef={cameraControlsRef}
        onPositionChange={onCameraPositionChange}
      />

      {/* VOB Click Handler */}
      {(onVobClickFromScene || onWaypointClickFromScene) && (
        <VobClickHandler onVobClick={onVobClickFromScene} onWaypointClick={onWaypointClickFromScene} />
      )}

      {/* VOB Renderer */}
      {world && zenKit && (
        <VOBRenderer
          world={world}
          zenKit={zenKit}
          cameraPosition={cameraPosition}
          onLoadingStatus={onLoadingStatus}
          onVobStats={onVobStats}
          selectedVob={selectedVob}
          onSelectedVobBoundingBox={onSelectedVobBoundingBox}
        />
      )}

      {/* Waynet Renderer */}
      {world && zenKit && (
        <WaynetRenderer
          world={world}
          zenKit={zenKit}
          cameraPosition={cameraPosition}
          enabled={true}
          selectedWaypoint={selectedWaypoint}
        />
      )}

      {/* NPC Renderer */}
      {world && zenKit && <NpcRenderer world={world} zenKit={zenKit} npcs={npcs} cameraPosition={cameraPosition} enabled={true} />}
    </>
  );
}

export function App() {
  const cameraControlsRef = useRef<CameraControlsRef>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [world, setWorld] = useState<World | null>(null);
  const [zenKit, setZenKit] = useState<ZenKit | null>(null);
  const [cameraPosition, setCameraPosition] = useState(new THREE.Vector3(0, 0, 0));
  const [vobStats, setVobStats] = useState<{
    loaded: number;
    total: number;
    queue: number;
    loading: number;
    meshCache: number;
    morphCache: number;
    textureCache: number;
  } | null>(null);

  const handleCameraChange = useCallback((position: [number, number, number], lookAt: [number, number, number]) => {
    if (cameraControlsRef.current) {
      cameraControlsRef.current.setPose(position, lookAt);
    }
  }, []);

  const handleLoadingStatus = useCallback((status: string) => {
    setLoadingStatus(status);
  }, []);

  const handleWorldLoaded = useCallback((loadedWorld: World, loadedZenKit: ZenKit) => {
    setWorld(loadedWorld);
    setZenKit(loadedZenKit);
  }, []);

  const handleCameraPositionChange = useCallback((position: THREE.Vector3) => {
    setCameraPosition(position);
  }, []);

  const handleVobStats = useCallback((stats: {
    loaded: number;
    total: number;
    queue: number;
    loading: number;
    meshCache: number;
    morphCache: number;
    textureCache: number;
  }) => {
    setVobStats(stats);
  }, []);

  const [selectedVob, setSelectedVob] = useState<Vob | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<WayPointData | null>(null);
  const shouldUpdateCameraRef = useRef(false);

  // NPC state management
  const [npcs, setNpcs] = useState<Map<number, NpcData>>(new Map());

  const handleVobClick = useCallback((vob: Vob) => {
    if (!vob) return;
    shouldUpdateCameraRef.current = true;
    setSelectedWaypoint(null);
    setSelectedVob(vob);
    logVobDetails(vob);
  }, []);

  const handleWaypointSelect = useCallback((waypoint: WayPointData) => {
    if (!waypoint?.name) return;
    setSelectedVob(null);
    setSelectedWaypoint(waypoint);
  }, []);

  const handleWaypointTeleport = useCallback((waypoint: WayPointData) => {
    if (!waypoint?.position || !cameraControlsRef.current) return;
    setSelectedVob(null);
    setSelectedWaypoint(waypoint);

    // Match renderer world space (flip X like VOBs/Waynet)
    const target = new THREE.Vector3(-waypoint.position.x, waypoint.position.y, waypoint.position.z);
    const offsetDirection = new THREE.Vector3(1, 0.5, 1).normalize();
    const distance = 400;
    const cameraPos = target.clone().add(offsetDirection.multiplyScalar(distance));

    cameraControlsRef.current.setPose(
      [cameraPos.x, cameraPos.y, cameraPos.z],
      [target.x, target.y, target.z]
    );
  }, []);

  const handleVobClickFromScene = useCallback((vob: Vob) => {
    if (!vob) return;
    // Only select, don't move camera
    setSelectedWaypoint(null);
    setSelectedVob(vob);
    logVobDetails(vob);
  }, []);

  const handleWaypointClickFromScene = useCallback((waypoint: WayPointData) => {
    // From scene: select, don't move camera (match VOB scene click behavior)
    handleWaypointSelect(waypoint);
  }, [handleWaypointSelect]);

  const handleSelectedVobBoundingBox = useCallback((center: THREE.Vector3, size: THREE.Vector3) => {
    if (size.length() === 0 || !shouldUpdateCameraRef.current || !cameraControlsRef.current) {
      return;
    }

    shouldUpdateCameraRef.current = false;

    const maxDimension = Math.max(size.x, size.y, size.z);
    const distance = maxDimension * 1.5 + 100;
    const offsetDirection = new THREE.Vector3(1, 0.5, 1).normalize();
    const cameraOffset = offsetDirection.clone().multiplyScalar(distance);

    const cameraPos: [number, number, number] = [
      center.x + cameraOffset.x,
      center.y + cameraOffset.y,
      center.z + cameraOffset.z
    ];

    const lookAtPos: [number, number, number] = [center.x, center.y, center.z];

    cameraControlsRef.current.setPose(cameraPos, lookAtPos);
  }, []);

  // Handle NPC spawn events from VM
  const handleNpcSpawn = useCallback<NpcSpawnCallback>((npcData) => {
    setNpcs(prev => {
      const newMap = new Map(prev);
      // Replace existing NPC if same instance index (move to new spawnpoint)
      newMap.set(npcData.instanceIndex, npcData);
      return newMap;
    });
  }, []);

  // Default world path - can be made configurable later
  const worldPath = "/WORLDS/NEWWORLD/NEWWORLD.ZEN";

  return (
    <>
      {/* VOB Tree - left side panel */}
      <VOBTree
        world={world}
        onVobClick={handleVobClick}
        onWaypointSelect={handleWaypointSelect}
        onWaypointTeleport={handleWaypointTeleport}
        selectedVob={selectedVob}
        selectedWaypoint={selectedWaypoint}
      />

      {/* Loading status display - outside Canvas */}
      {loadingStatus && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '330px', // Adjusted to be after the VOB tree
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '10px',
          borderRadius: '5px',
          fontSize: '12px',
          fontFamily: 'monospace',
          maxWidth: '400px',
          zIndex: 1000
        }}>
          <div>Loading Status: {loadingStatus}</div>
          {vobStats && (
            <div style={{ marginTop: '8px', fontSize: '11px', borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: '8px' }}>
              📦 VOBs: {vobStats.loaded}/{vobStats.total} loaded | Queue: {vobStats.queue} | Loading: {vobStats.loading} | Cache: {vobStats.meshCache} meshes, {vobStats.morphCache} morphs, {vobStats.textureCache} textures
            </div>
          )}
        </div>
      )}

      <Canvas
        gl={{
          alpha: false,
          antialias: true,
          logarithmicDepthBuffer: true,  // Better depth precision for large scenes
          outputColorSpace: THREE.SRGBColorSpace,  // Critical for proper color display
          sortObjects: true,  // Ensure proper depth sorting
          pixelRatio: 1,  // Force 1:1 pixel ratio to match zen-viewer
          powerPreference: 'default',  // Match zen-viewer default
          toneMapping: THREE.NoToneMapping  // Disable tone mapping for more faded appearance
        }}
        camera={{
          position: [0, 0, 0],
          fov: 75,
          near: 1.0,
          far: 100000
        }}
        style={{ background: '#222222' }}
      >
        <Scene
          cameraControlsRef={cameraControlsRef}
          worldPath={worldPath}
          onLoadingStatus={handleLoadingStatus}
          world={world}
          zenKit={zenKit}
          onWorldLoaded={handleWorldLoaded}
          cameraPosition={cameraPosition}
          onCameraPositionChange={handleCameraPositionChange}
          onVobStats={handleVobStats}
          selectedVob={selectedVob}
          onSelectedVobBoundingBox={handleSelectedVobBoundingBox}
          selectedWaypoint={selectedWaypoint}
          onVobClickFromScene={handleVobClickFromScene}
          onWaypointClickFromScene={handleWaypointClickFromScene}
          npcs={npcs}
          onNpcSpawn={handleNpcSpawn}
        />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
