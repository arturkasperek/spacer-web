import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Physics } from "@react-three/rapier";
import { NavigationOverlay } from "./waynet/navigation";
import { AxesHelper } from "./world/axes";
import { SkyComponent } from "./world/sky";
import { createRef, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CameraControls, CameraControlsRef } from "./camera/camera-controls";
import { WorldRenderer } from "./world/world-renderer";
import { VOBRenderer } from "./vob/vob-renderer";
import { WaynetRenderer } from "./waynet/waynet-renderer";
import { NpcRenderer } from "./npc/renderer/npc-renderer";
import { VOBTree } from "./vob/vob-tree";
import { VobClickHandler } from "./vob/vob-click-handler";
import { logVobDetails } from "./vob/vob-utils";
import { WorldTimeTicker } from "./world/world-time-ticker";
import { WorldTimeOverlay } from "./world/world-time-overlay";
import { WorldTimeLighting } from "./world/world-time-lighting";
import { NpcInspectorOverlay } from "./npc/renderer/npc-inspector-overlay";
import { TopMenuBar, TOP_MENU_HEIGHT } from "./ui/top-menu-bar";
import { setUiSettings, useUiSettings } from "./ui/ui-settings";
import { useViewSettings } from "./ui/view-settings";
import type { World, ZenKit, Vob, WayPointData } from "@kolarz3/zenkit";
import type { NpcData, NpcSpawnCallback } from "./shared/types";
import { setFreepointsWorld } from "./npc/world/npc-freepoints";
import { PlayerInputProvider } from "./player/player-input-context";
import { FpsOverlay } from "./ui/fps-overlay";

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();

// Component to track camera position changes
function CameraPositionTracker({
  cameraControlsRef,
  onPositionChange,
}: {
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

function Scene({
  cameraControlsRef,
  worldPath,
  onLoadingStatus,
  world,
  zenKit,
  onWorldLoaded,
  cameraPosition,
  onCameraPositionChange,
  onVobStats,
  selectedVob,
  onSelectedVobBoundingBox,
  selectedWaypoint,
  onVobClickFromScene,
  onWaypointClickFromScene,
  onNpcClickFromScene,
  npcs,
  onNpcSpawn,
  viewSettings,
}: Readonly<{
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  worldPath: string;
  onLoadingStatus: (status: string) => void;
  world: World | null;
  zenKit: ZenKit | null;
  onWorldLoaded: (world: World, zenKit: ZenKit) => void;
  cameraPosition: THREE.Vector3;
  onCameraPositionChange: (position: THREE.Vector3) => void;
  onVobStats: (stats: {
    loaded: number;
    total: number;
    queue: number;
    loading: number;
    meshCache: number;
    morphCache: number;
    textureCache: number;
  }) => void;
  selectedVob: Vob | null;
  onSelectedVobBoundingBox: (center: THREE.Vector3, size: THREE.Vector3) => void;
  selectedWaypoint: WayPointData | null;
  onVobClickFromScene?: (vob: Vob) => void;
  onWaypointClickFromScene?: (waypoint: WayPointData) => void;
  onNpcClickFromScene?: (npc: NpcData, npcRoot: THREE.Object3D) => void;
  npcs: Map<number, NpcData>;
  onNpcSpawn: NpcSpawnCallback;
  viewSettings: {
    showWaypoints: boolean;
    showVobSpots: boolean;
    showLights: boolean;
    showFpsMeter: boolean;
    showKccCapsule: boolean;
    showGroundProbeRay: boolean;
    showJumpDebugRange: boolean;
    hideHero: boolean;
    timeScale: number;
  };
}>) {
  const { camera } = useThree();
  const didInitCameraRef = useRef(false);

  // Store the camera reference
  cameraRef.current = camera;

  // Set initial camera pose
  useEffect(() => {
    camera.rotation.order = "YXZ";
    camera.updateProjectionMatrix();

    if (didInitCameraRef.current) return;
    const controls = cameraControlsRef.current;
    if (!controls) return;
    if (!world) return;

    const getVobWorldTransform = (
      vob: any,
    ): { pos: THREE.Vector3; quat: THREE.Quaternion } | null => {
      if (!vob?.position) return null;
      const rotArray = vob?.rotation?.toArray?.();
      const m: number[] = [];
      if (rotArray && typeof rotArray.size === "function" && typeof rotArray.get === "function") {
        const n = rotArray.size();
        for (let i = 0; i < n; i++) m.push(rotArray.get(i));
      } else {
        m.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
      }

      const transformMat = new THREE.Matrix4();
      transformMat.set(
        -m[0],
        -m[3],
        -m[6],
        -(vob.position?.x ?? 0),
        m[1],
        m[4],
        m[7],
        vob.position?.y ?? 0,
        m[2],
        m[5],
        m[8],
        vob.position?.z ?? 0,
        0,
        0,
        0,
        1,
      );

      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      transformMat.decompose(pos, quat, scale);
      return { pos, quat };
    };

    const resolveStartTarget = (): { pos: THREE.Vector3; quat: THREE.Quaternion } => {
      try {
        const startpoints = (world as any)?.getStartpoints?.();
        if (
          startpoints &&
          typeof startpoints.size === "function" &&
          typeof startpoints.get === "function"
        ) {
          const n = Number(startpoints.size());
          if (Number.isFinite(n) && n > 0) {
            const sp0 = startpoints.get(0);
            const tr = getVobWorldTransform(sp0);
            if (tr) return tr;
          }
        }
      } catch {
        // ignore
      }

      return { pos: new THREE.Vector3(0, 0, 0), quat: new THREE.Quaternion() };
    };

    const tr = resolveStartTarget();
    const followDistance = 220;
    const followHeight = 140;
    const lookAtHeight = 110;

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(tr.quat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    else forward.normalize();

    const lookAt = tr.pos.clone();
    lookAt.y += lookAtHeight;

    const camPos = tr.pos.clone().addScaledVector(forward, -followDistance);
    camPos.y += followHeight;

    controls.setPose([camPos.x, camPos.y, camPos.z], [lookAt.x, lookAt.y, lookAt.z]);
    didInitCameraRef.current = true;
  }, [camera, cameraControlsRef, world]);

  return (
    <>
      <CameraControls ref={cameraControlsRef} />
      <WorldTimeTicker />
      <WorldTimeLighting />

      <AxesHelper />

      <SkyComponent />

      {/* World Renderer */}
      <WorldRenderer
        worldPath={worldPath}
        onLoadingStatus={onLoadingStatus}
        onWorldLoaded={onWorldLoaded}
        onNpcSpawn={onNpcSpawn}
      />

      {/* Camera position tracker */}
      <CameraPositionTracker
        cameraControlsRef={cameraControlsRef}
        onPositionChange={onCameraPositionChange}
      />

      {/* VOB Click Handler */}
      {(onVobClickFromScene || onWaypointClickFromScene || onNpcClickFromScene) && (
        <VobClickHandler
          onVobClick={onVobClickFromScene}
          onWaypointClick={onWaypointClickFromScene}
          onNpcClick={onNpcClickFromScene}
        />
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
          showVobSpots={viewSettings.showVobSpots}
          showLights={viewSettings.showLights}
        />
      )}

      {/* Waynet Renderer */}
      {world && zenKit && (
        <WaynetRenderer
          world={world}
          zenKit={zenKit}
          cameraPosition={cameraPosition}
          enabled={viewSettings.showWaypoints}
          selectedWaypoint={selectedWaypoint}
        />
      )}

      {/* NPC Renderer */}
      {world && zenKit && (
        <NpcRenderer
          world={world}
          zenKit={zenKit}
          npcs={npcs}
          cameraPosition={cameraPosition}
          enabled={true}
          showKccCapsule={viewSettings.showKccCapsule}
          showGroundProbeRay={viewSettings.showGroundProbeRay}
          showJumpDebugRange={viewSettings.showJumpDebugRange}
          hideHero={viewSettings.hideHero}
        />
      )}
    </>
  );
}

export function App() {
  const cameraControlsRef = useRef<CameraControlsRef>(null);
  const viewSettings = useViewSettings();
  const ui = useUiSettings();
  const [loadingStatus, setLoadingStatus] = useState<string>("");
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

  const handleCameraChange = useCallback(
    (position: [number, number, number], lookAt: [number, number, number]) => {
      if (cameraControlsRef.current) {
        cameraControlsRef.current.setPose(position, lookAt);
      }
    },
    [],
  );

  const handleLoadingStatus = useCallback((status: string) => {
    setLoadingStatus(status);
  }, []);

  const handleWorldLoaded = useCallback((loadedWorld: World, loadedZenKit: ZenKit) => {
    setWorld(loadedWorld);
    setZenKit(loadedZenKit);
    setFreepointsWorld(loadedWorld);
  }, []);

  const handleCameraPositionChange = useCallback((position: THREE.Vector3) => {
    setCameraPosition(position);
  }, []);

  const handleVobStats = useCallback(
    (stats: {
      loaded: number;
      total: number;
      queue: number;
      loading: number;
      meshCache: number;
      morphCache: number;
      textureCache: number;
    }) => {
      setVobStats(stats);
    },
    [],
  );

  const [selectedVob, setSelectedVob] = useState<Vob | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<WayPointData | null>(null);
  const [inspectedNpc, setInspectedNpc] = useState<{
    npc: NpcData;
    npcRoot: THREE.Object3D;
  } | null>(null);
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
    const target = new THREE.Vector3(
      -waypoint.position.x,
      waypoint.position.y,
      waypoint.position.z,
    );
    const offsetDirection = new THREE.Vector3(1, 0.5, 1).normalize();
    const distance = 400;
    const cameraPos = target.clone().add(offsetDirection.multiplyScalar(distance));

    cameraControlsRef.current.setPose(
      [cameraPos.x, cameraPos.y, cameraPos.z],
      [target.x, target.y, target.z],
    );
  }, []);

  const handleVobClickFromScene = useCallback((vob: Vob) => {
    if (!vob) return;
    // Only select, don't move camera
    setSelectedWaypoint(null);
    setSelectedVob(vob);
    logVobDetails(vob);
  }, []);

  const handleWaypointClickFromScene = useCallback(
    (waypoint: WayPointData) => {
      // From scene: select, don't move camera (match VOB scene click behavior)
      handleWaypointSelect(waypoint);
    },
    [handleWaypointSelect],
  );

  const handleNpcClickFromScene = useCallback((npc: NpcData, npcRoot: THREE.Object3D) => {
    setInspectedNpc({ npc, npcRoot });
  }, []);

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
      center.z + cameraOffset.z,
    ];

    const lookAtPos: [number, number, number] = [center.x, center.y, center.z];

    cameraControlsRef.current.setPose(cameraPos, lookAtPos);
  }, []);

  // Handle NPC spawn events from VM
  const handleNpcSpawn = useCallback<NpcSpawnCallback>((npcData) => {
    setNpcs((prev) => {
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
      <TopMenuBar />
      {ui.showStatusBar && (
        <WorldTimeOverlay onClose={() => setUiSettings({ showStatusBar: false })} />
      )}
      <NpcInspectorOverlay
        selected={inspectedNpc}
        onClose={() => setInspectedNpc(null)}
        topOffsetPx={TOP_MENU_HEIGHT}
      />
      {/* VOB Tree - left side panel */}
      {ui.showVobTree && (
        <VOBTree
          world={world}
          onVobClick={handleVobClick}
          onWaypointSelect={handleWaypointSelect}
          onWaypointTeleport={handleWaypointTeleport}
          selectedVob={selectedVob}
          selectedWaypoint={selectedWaypoint}
          topOffsetPx={TOP_MENU_HEIGHT}
          onClose={() => setUiSettings({ showVobTree: false })}
        />
      )}

      {/* Loading status display - outside Canvas */}
      {loadingStatus && (
        <div
          style={{
            position: "absolute",
            top: `${TOP_MENU_HEIGHT + 10}px`,
            left: ui.showVobTree ? "330px" : "10px", // Adjusted to be after the VOB tree
            background: "rgba(0, 0, 0, 0.8)",
            color: "white",
            padding: "10px",
            borderRadius: "5px",
            fontSize: "12px",
            fontFamily: "monospace",
            maxWidth: "400px",
            zIndex: 1000,
          }}
        >
          <div>Loading Status: {loadingStatus}</div>
          {vobStats && (
            <div
              style={{
                marginTop: "8px",
                fontSize: "11px",
                borderTop: "1px solid rgba(255,255,255,0.3)",
                paddingTop: "8px",
              }}
            >
              📦 VOBs: {vobStats.loaded}/{vobStats.total} loaded | Queue: {vobStats.queue} |
              Loading: {vobStats.loading} | Cache: {vobStats.meshCache} meshes,{" "}
              {vobStats.morphCache} morphs, {vobStats.textureCache} textures
            </div>
          )}
        </div>
      )}

      <Canvas
        gl={{
          alpha: false,
          antialias: true,
          logarithmicDepthBuffer: true, // Better depth precision for large scenes
          outputColorSpace: THREE.SRGBColorSpace, // Critical for proper color display
          sortObjects: true, // Ensure proper depth sorting
          pixelRatio: 1, // Force 1:1 pixel ratio to match zen-viewer
          powerPreference: "default", // Match zen-viewer default
          toneMapping: THREE.NoToneMapping, // Disable tone mapping for more faded appearance
        }}
        camera={{
          position: [0, 0, 0],
          fov: 67.5, // Match OpenGothic default FOV
          near: 10.0, // Match OpenGothic zNear (10cm)
          far: 100000, // Match OpenGothic zFar
        }}
        style={{ background: "#222222" }}
      >
        <PlayerInputProvider>
          <Physics>
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
              onNpcClickFromScene={handleNpcClickFromScene}
              npcs={npcs}
              onNpcSpawn={handleNpcSpawn}
              viewSettings={viewSettings}
            />
            <FpsOverlay enabled={viewSettings.showFpsMeter} />
          </Physics>
        </PlayerInputProvider>
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
