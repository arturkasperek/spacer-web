import { useRef, useEffect, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getMeshPath, getModelPath, getMorphMeshPath, tgaNameToCompiledUrl, getVobType, getVobTypeName, shouldUseHelperVisual } from "./vob-utils";
import { VOBBoundingBox } from "./vob-bounding-box";
import type { World, ZenKit, Vob, ProcessedMeshData, Model, MorphMesh } from '@kolarz3/zenkit';

interface VobData {
  id: string;
  vob: Vob;
  position: THREE.Vector3;
  visualName: string;
  vobType?: number; // VOB type (e.g., 11 for zCVobSpot)
}

// VOB Renderer Component - loads and renders Virtual Object Bases (VOBs)
function VOBRenderer({ world, zenKit, cameraPosition, onLoadingStatus, onVobStats, selectedVob, onSelectedVobBoundingBox }: Readonly<{
  world: World | null;
  zenKit: ZenKit | null;
  cameraPosition?: THREE.Vector3;
  onLoadingStatus: (status: string) => void;
  onVobStats?: (stats: { loaded: number; total: number; queue: number; loading: number; meshCache: number; morphCache: number; textureCache: number; }) => void;
  selectedVob?: Vob | null;
  onSelectedVobBoundingBox?: (center: THREE.Vector3, size: THREE.Vector3) => void;
}>) {
  const { scene } = useThree();
  const hasLoadedRef = useRef(false);

  // VOB management state
  const loadedVOBsRef = useRef(new Map<string, THREE.Object3D>()); // vob id -> THREE.Mesh/Object3D
  const allVOBsRef = useRef<VobData[]>([]); // All VOB data from world
  const lastCameraPositionRef = useRef(new THREE.Vector3());
  const VOB_LOAD_DISTANCE = 5000; // Load VOBs within this distance
  const VOB_UNLOAD_DISTANCE = 6000; // Unload VOBs beyond this distance

  // Asset caches to avoid reloading
  const meshCacheRef = useRef(new Map<string, ProcessedMeshData>()); // path -> processed mesh data
  const textureCacheRef = useRef(new Map<string, THREE.DataTexture>()); // path -> THREE.DataTexture
  const materialCacheRef = useRef(new Map<string, THREE.Material>()); // texture path -> THREE.Material
  const modelCacheRef = useRef(new Map<string, Model>()); // path -> ZenKit Model instance
  const morphMeshCacheRef = useRef(new Map<string, { morphMesh: MorphMesh; processed: ProcessedMeshData; animations: string[] }>()); // path -> { morphMesh, processed, animations }

  // Streaming loader state
  const vobLoadQueueRef = useRef<VobData[]>([]);
  const loadingVOBsRef = useRef(new Set<string>()); // Track currently loading VOBs
  const isFirstVOBUpdateRef = useRef(true);
  const updateCounterRef = useRef(0);
  const MAX_CONCURRENT_LOADS = 15; // Load up to 15 VOBs concurrently

  useEffect(() => {
    // Only load once
    if (hasLoadedRef.current || !world || !zenKit) return;

    hasLoadedRef.current = true;

    const loadVOBs = async () => {
      try {
        onLoadingStatus('🔧 Collecting VOBs...');

        // Collect VOBs from world
        await collectVOBs(world);

        // Start the streaming loader
        onLoadingStatus(`🎬 Starting streaming VOB loader (${allVOBsRef.current.length} VOBs)...`);
        // Streaming will now be handled by useFrame hook

      } catch (error) {
        console.error('❌ Failed to load VOBs:', error);
        onLoadingStatus(`❌ Failed to load VOBs: ${(error as Error).message}`);
      }
    };

    loadVOBs();
  }, [world, zenKit, onLoadingStatus]);

  // Collect VOB data from world
  const collectVOBs = async (world: World) => {
    const vobs = world.getVobs();
    const vobCount = vobs.size();
    console.log(`Found ${vobCount} root VOBs`);

    let totalCount = 0;
    const visualTypeCounts: { [key: string]: number } = {};

    // Recursive function to collect VOB data
    function collectVobTree(vob: Vob, vobId = 0) {
      totalCount++;

      // Track visual type statistics
      const typeKey = `Type_${vob.visual.type}`;
      visualTypeCounts[typeKey] = (visualTypeCounts[typeKey] || 0) + 1;

      // Get VOB type
      const vobType = getVobType(vob);
      
      // Determine if visual is available
      const hasVisual = vob.showVisual && vob.visual.name &&
          (vob.visual.type === 1 || vob.visual.type === 2 || vob.visual.type === 5 || vob.visual.type === 6) &&
          !vob.visual.name.toUpperCase().endsWith('.TEX') &&
          !vob.visual.name.toUpperCase().endsWith('.TGA');
      
      // Determine visual name: use actual visual if available, otherwise use INVISIBLE_{VOBTYPENAME}.MRM
      // But exclude certain VOB types from getting helper visuals (zCVob, oCItem, oCNpc, zCVobStair)
      let visualName: string;
      if (hasVisual) {
        visualName = vob.visual.name;
      } else if (shouldUseHelperVisual(vobType)) {
        const vobTypeName = getVobTypeName(vobType);
        visualName = vobTypeName ? `INVISIBLE_${vobTypeName}.MRM` : '';
      } else {
        visualName = '';
      }

      // Only store VOBs that have visible meshes OR have a valid VOB type (for invisible helper visuals)
      if (hasVisual || (visualName && vobType !== undefined && vobType !== null)) {
          allVOBsRef.current.push({
            id: `${vobId}_${totalCount}`,
            vob: vob,
            position: new THREE.Vector3(-vob.position.x, vob.position.y, vob.position.z),
            visualName: visualName!,
            vobType: vobType
          });
      }

      // Process children recursively
      const childCount = vob.children.size();
      for (let i = 0; i < childCount; i++) {
        collectVobTree(vob.children.get(i), vobId);
      }
    }

    // Collect all VOBs
    for (let i = 0; i < vobCount; i++) {
      const vob = vobs.get(i);
      collectVobTree(vob, i);
    }

    console.log(`📊 Total VOBs (including children): ${totalCount}`);
    console.log(`📊 Renderable VOBs: ${allVOBsRef.current.length}`);

    const typeNames = ['DECAL', 'MESH', 'MULTI_RES_MESH', 'PARTICLE', 'CAMERA', 'MODEL', 'MORPH_MESH', 'UNKNOWN'];
    console.log('📊 Visual type breakdown:');
    Object.keys(visualTypeCounts).sort().forEach(key => {
      const typeNum = parseInt(key.split('_')[1]);
      const typeName = typeNames[typeNum] || 'UNKNOWN';
      console.log(`   ${typeName} (${typeNum}): ${visualTypeCounts[key]}`);
    });
  };

  // Streaming VOB loader - loads/unloads based on camera distance
  const updateVOBStreaming = () => {

    // Use the camera position passed from parent component (fallback to origin if not provided)
    const camPos = cameraPosition || new THREE.Vector3(0, 0, 0);

    // Check if camera moved significantly OR if this is the first update
    const distance = lastCameraPositionRef.current.distanceTo(camPos);
    const shouldUpdate = isFirstVOBUpdateRef.current || distance > 100;

    if (shouldUpdate) {
      isFirstVOBUpdateRef.current = false;
      lastCameraPositionRef.current.copy(camPos);

      // Find VOBs to load/unload
      vobLoadQueueRef.current = [];
      const toUnload = [];

      for (const vobData of allVOBsRef.current) {
        const distance = camPos.distanceTo(vobData.position);
        const isLoaded = loadedVOBsRef.current.has(vobData.id);

        if (distance < VOB_LOAD_DISTANCE && !isLoaded) {
          vobLoadQueueRef.current.push(vobData);
        } else if (distance > VOB_UNLOAD_DISTANCE && isLoaded) {
          toUnload.push(vobData.id);
        }
      }

      // Unload distant VOBs
      for (const id of toUnload) {
        const mesh = loadedVOBsRef.current.get(id);
        if (mesh) {
          scene.remove(mesh);
          disposeObject3D(mesh);
          loadedVOBsRef.current.delete(id);
        }
      }

      // Sort queue by distance (closest first)
      vobLoadQueueRef.current.sort((a, b) => {
        return camPos.distanceTo(a.position) - camPos.distanceTo(b.position);
      });
    }

    // Load multiple VOBs concurrently (up to MAX_CONCURRENT_LOADS) to speed up loading
    const currentlyLoading = loadingVOBsRef.current.size;
    const availableSlots = MAX_CONCURRENT_LOADS - currentlyLoading;

    // Start loading new VOBs if we have available slots and items in queue
    for (let i = 0; i < Math.min(availableSlots, vobLoadQueueRef.current.length); i++) {
      const vobData = vobLoadQueueRef.current.shift();
      if (vobData) {
        loadingVOBsRef.current.add(vobData.id);

        renderVOB(vobData.vob, vobData.id, vobData).then(success => {
          loadingVOBsRef.current.delete(vobData.id);
          if (!success) {
            console.warn(`❌ Failed to render VOB: ${vobData.visualName}`);
          } else {
            console.log(`✅ Successfully rendered VOB: ${vobData.visualName} (id: ${vobData.id})`);
          }
        });
      }
    }

    // Update debug info and stats
    const loadedCount = loadedVOBsRef.current.size;
    const totalCount = allVOBsRef.current.length;
    const queueCount = vobLoadQueueRef.current.length;

    // Report stats to parent component
    if (onVobStats) {
      onVobStats({
        loaded: loadedCount,
        total: totalCount,
        queue: queueCount, // Items waiting in queue
        loading: currentlyLoading, // Items currently being loaded
        meshCache: meshCacheRef.current.size,
        morphCache: morphMeshCacheRef.current.size,
        textureCache: textureCacheRef.current.size
      });
    }

    // Streaming continues via useFrame hook
  };

  // Helper function to properly dispose of Three.js objects
  const disposeObject3D = (object: THREE.Object3D) => {
    if (!object) return;

    // If it's a Mesh, dispose its geometry
    if ((object as THREE.Mesh).geometry) {
      (object as THREE.Mesh).geometry.dispose();
    }

    // If it's a Group or has children, recursively dispose children
    if (object.children && object.children.length > 0) {
      for (const child of object.children) {
        disposeObject3D(child);
      }
    }

    // Note: materials are cached and shared, don't dispose them
  };

  // Alternative approach: use useFrame for continuous streaming updates
  useFrame(() => {
    if (hasLoadedRef.current && allVOBsRef.current.length > 0) {
      // Only run streaming update every few frames to reduce overhead
      if (updateCounterRef.current % 10 === 0) {  // Every 10 frames
        updateVOBStreaming();
      }
      updateCounterRef.current++;
    }
  });

  // Main VOB rendering dispatcher
  const renderVOB = async (vob: Vob, vobId: string | null = null, vobData?: VobData): Promise<boolean> => {
    // Get VOB type from vobData if available, otherwise from vob directly
    const vobType = vobData?.vobType ?? getVobType(vob);
    
    // Get visual name from vobData if available, otherwise from vob
    const visualName = vobData?.visualName ?? vob.visual.name;
    
    // Skip if no visual name
    if (!visualName) {
      return false;
    }

    // Check if this is a helper visual (VOB has no visual or empty visual name)
    // But exclude certain VOB types that shouldn't use helper visuals
    const isHelperVisual = (!vob.visual.name || vob.visual.name.trim() === '') &&
                           shouldUseHelperVisual(vobType);

    // Skip if visual disabled (unless it's a helper visual)
    if (!isHelperVisual && !vob.showVisual) {
      return false;
    }

    // Skip if visual name has texture extension (indicates it's not a mesh)
    if (visualName.toUpperCase().endsWith('.TEX') || visualName.toUpperCase().endsWith('.TGA')) {
      return false;
    }

    // For helper visuals, treat as regular mesh
    if (isHelperVisual) {
      const meshPath = getMeshPath(visualName);
      if (!meshPath) {
        return false;
      }
      return await renderMeshVOB(vob, vobId, meshPath, vobType);
    }

    // Only render mesh visuals
    // Type 0 = DECAL (sprite/texture, not 3D mesh)
    // Type 1 = MESH (static 3D mesh)
    // Type 2 = MULTI_RESOLUTION_MESH (LOD mesh)
    // Type 3 = PARTICLE_EFFECT, 4 = AI_CAMERA, 5 = MODEL, 6 = MORPH_MESH
    if (vob.visual.type !== 1 && vob.visual.type !== 2 && vob.visual.type !== 5 && vob.visual.type !== 6) {
      return false; // Skip non-mesh visuals (decals, particles, etc.)
    }

    // Handle different visual types
    if (vob.visual.type === 5) {
      // MODEL (5) - load .MDL file
      return await renderModelVOB(vob, vobId);
    } else if (vob.visual.type === 6) {
      // MORPH_MESH (6) - load .MMB file
      console.log(`🐟 Detected morph mesh VOB: ${visualName} (type: ${vob.visual.type})`);
      return await renderMorphMeshVOB(vob, vobId);
    } else {
      // MESH (1) or MULTI_RES_MESH (2) - load mesh file
      const meshPath = getMeshPath(visualName);
      if (!meshPath) {
        return false;
      }

      return await renderMeshVOB(vob, vobId, meshPath, vobType);
    }
  };

  // Render mesh VOB
  const renderMeshVOB = async (vob: Vob, vobId: string | null, meshPath: string, vobType?: number): Promise<boolean> => {
    if (!zenKit) return false;
    
    try {
      // Load mesh with caching
      const processed = await loadMeshCached(meshPath, zenKit);
      if (!processed) {
        return false;
      }

      // Build Three.js geometry and materials
      const { geometry, materials } = await buildThreeJSGeometryAndMaterials(processed, zenKit, vobType);

      // Verify geometry has data
      if (!geometry || geometry.attributes.position === undefined || geometry.attributes.position.count === 0) {
        console.warn(`⚠️ Empty geometry for VOB: ${vob.visual.name}`);
        return false;
      }

      // Create mesh
      const vobMeshObj = new THREE.Mesh(geometry, materials);
      
      // Store VOB reference for click detection
      vobMeshObj.userData.vob = vob;
      
      // Verify materials
      if (!materials || (Array.isArray(materials) && materials.length === 0)) {
        console.warn(`⚠️ No materials for VOB: ${vob.visual.name}`);
      }
      
      console.log(`🔧 Created mesh for VOB: ${vob.visual.name}, vertices: ${geometry.attributes.position.count}, materials: ${Array.isArray(materials) ? materials.length : 1}`);

      // Apply VOB transform
      applyVobTransform(vobMeshObj, vob);

      // Register loaded VOB and add to scene
      if (vobId) {
        loadedVOBsRef.current.set(vobId, vobMeshObj);
        scene.add(vobMeshObj);
        console.log(`✅ Added mesh VOB to scene: ${vob.visual.name} at (${vobMeshObj.position.x.toFixed(1)}, ${vobMeshObj.position.y.toFixed(1)}, ${vobMeshObj.position.z.toFixed(1)}), scene children: ${scene.children.length}`);
        
        // Verify it's actually in the scene
        if (!scene.children.includes(vobMeshObj)) {
          console.error(`❌ ERROR: VOB was not added to scene! ${vob.visual.name}`);
        }
      } else {
        console.warn(`⚠️ Skipping VOB add to scene - no vobId: ${vob.visual.name}`);
      }

      return true;

    } catch (error) {
      console.warn(`Failed to render mesh VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Render model VOB
  const renderModelVOB = async (vob: Vob, vobId: string | null): Promise<boolean> => {
    if (!zenKit) return false;
    
    try {
      const visualName = vob.visual.name;

      // Build model path - convert to .MDL file
      const modelPath = getModelPath(visualName);
      if (!modelPath) {
        return false;
      }

      // Load model with caching
      const model = await loadModelCached(modelPath, zenKit);
      if (!model) {
        return false;
      }

      // Check for attachments first
      const attachmentNames = model.getAttachmentNames();
      const attachmentCount = attachmentNames.size();

      // Check for soft-skin meshes if no attachments
      if (attachmentCount === 0) {
        // TypeScript may not recognize these methods, but they exist at runtime
        const softSkinMeshes = (model as any).getSoftSkinMeshes?.();
        const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;
        
        if (softSkinCount === 0) {
          return false;
        }
        
        // Render soft-skin meshes
        // In OpenGothic, soft-skin meshes use skeleton transforms, but for static models
        // they're positioned relative to the root node translation
        const hierarchy = model.getHierarchy();
        const modelGroup = new THREE.Group();
        
        // Store VOB reference for click detection
        modelGroup.userData.vob = vob;
        
        // Get root translation from hierarchy (similar to OpenGothic's mkBaseTranslation)
        // OpenGothic's mkBaseTranslation() extracts from processed root node transform and negates it
        // We use the hierarchy's root_translation directly, negated
        let rootNodeTranslation = new THREE.Vector3(0, 0, 0);
        if (hierarchy.rootTranslation) {
          rootNodeTranslation.set(
            -hierarchy.rootTranslation.x,
            -hierarchy.rootTranslation.y,
            -hierarchy.rootTranslation.z
          );
        }
        
        for (let i = 0; i < softSkinCount; i++) {
          const softSkinMesh = softSkinMeshes.get(i);
          if (!softSkinMesh) continue;

          // Convert soft-skin mesh to processed mesh data
          const processed = (model as any).convertSoftSkinMeshToProcessedMesh(softSkinMesh);
          if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
            continue;
          }

          // Build Three.js geometry and materials
          const { geometry, materials } = await buildThreeJSGeometryAndMaterials(processed, zenKit);

          // Create mesh - soft-skin meshes are positioned relative to root node
          // Apply root node translation offset (similar to OpenGothic's mkBaseTranslation logic)
          const softSkinMeshObj = new THREE.Mesh(geometry, materials);
          softSkinMeshObj.position.copy(rootNodeTranslation);

          modelGroup.add(softSkinMeshObj);
        }
        
        if (modelGroup.children.length === 0) {
          return false;
        }
        
        // Apply VOB transform
        applyVobTransform(modelGroup, vob);
        scene.add(modelGroup);
        
        if (vobId) {
          loadedVOBsRef.current.set(vobId, modelGroup);
        }
        
        return true;
      }

      // Get the model hierarchy to position attachments correctly
      const hierarchy = model.getHierarchy();

      // Create a group to hold all attachment meshes
      const modelGroup = new THREE.Group();
      
      // Store VOB reference for click detection
      modelGroup.userData.vob = vob;

      // Helper function to accumulate transforms up the hierarchy chain
      function getAccumulatedTransform(nodeIndex: number) {
        let currentIndex = nodeIndex;
        let accumulatedMatrix = new THREE.Matrix4();

        // Walk from leaf to root, accumulating transforms
        while (currentIndex >= 0) {
          const node = hierarchy.nodes.get ? hierarchy.nodes.get(currentIndex) : hierarchy.nodes[currentIndex];
          const nodeTransform = node.getTransform();
          const nodeMatrix = new THREE.Matrix4();

          // Convert column-major matrix data to Three.js Matrix4
          const matrixData = nodeTransform.toArray();
          for (let i = 0; i < 16; i++) {
            nodeMatrix.elements[i] = matrixData[i];
          }

          // Pre-multiply: accumulated = node * accumulated
          const tempMatrix = new THREE.Matrix4();
          tempMatrix.multiplyMatrices(nodeMatrix, accumulatedMatrix);
          accumulatedMatrix = tempMatrix;

          currentIndex = node.parentIndex;
        }

        return accumulatedMatrix;
      }

      // Render each attachment with proper positioning from hierarchy
      for (let i = 0; i < attachmentCount; i++) {
        const attachmentName = attachmentNames.get(i);
        const attachment = model.getAttachment(attachmentName);
        if (!attachment) continue;

        // Find the corresponding hierarchy node for this attachment
        let hierarchyNodeIndex = -1;
        const nodeCount = hierarchy.nodes.size ? hierarchy.nodes.size() : (hierarchy.nodes.length ?? 0);
        for (let j = 0; j < nodeCount; j++) {
          const node = hierarchy.nodes.get ? hierarchy.nodes.get(j) : hierarchy.nodes[j];
          if (node && node.name === attachmentName) {
            hierarchyNodeIndex = j;
            break;
          }
        }

        // Convert attachment to processed mesh data
        const processed = model.convertAttachmentToProcessedMesh(attachment);
        if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
          continue;
        }

        // Build Three.js geometry and materials using shared function
        const { geometry, materials } = await buildThreeJSGeometryAndMaterials(processed, zenKit);

        // Create mesh for this attachment
        const attachmentMesh = new THREE.Mesh(geometry, materials);

        // Apply accumulated hierarchy transform if found
        if (hierarchyNodeIndex >= 0) {
          const accumulatedMatrix = getAccumulatedTransform(hierarchyNodeIndex);
          attachmentMesh.applyMatrix4(accumulatedMatrix);
        }

        modelGroup.add(attachmentMesh);
      }

      if (modelGroup.children.length === 0) {
        return false;
      }

      // Apply VOB transform using the same approach as regular VOBs
      applyVobTransform(modelGroup, vob);

      // Register loaded VOB and add to scene
      if (vobId) {
        loadedVOBsRef.current.set(vobId, modelGroup);
        scene.add(modelGroup);
        console.log(`✅ Added model VOB to scene: ${vob.visual.name} at (${modelGroup.position.x.toFixed(1)}, ${modelGroup.position.y.toFixed(1)}, ${modelGroup.position.z.toFixed(1)}), children: ${modelGroup.children.length}`);
        
        // Verify it's actually in the scene
        if (!scene.children.includes(modelGroup)) {
          console.error(`❌ ERROR: Model VOB was not added to scene! ${vob.visual.name}`);
        }
      } else {
        console.warn(`⚠️ Skipping model VOB add to scene - no vobId: ${vob.visual.name}`);
      }

      return true;

    } catch (error) {
      console.warn(`Failed to render model VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Render morph mesh VOB
  const renderMorphMeshVOB = async (vob: Vob, vobId: string | null): Promise<boolean> => {
    if (!zenKit) return false;
    
    try {
      const visualName = vob.visual.name;

      // Build morph mesh path - convert to .MMB file
      const morphPath = getMorphMeshPath(visualName);
      if (!morphPath) {
        return false;
      }

      // Load morph mesh with caching
      const morphData = await loadMorphMeshCached(morphPath, zenKit);
      if (!morphData) {
        return false;
      }

      // Build Three.js geometry and materials from processed mesh data
      const { geometry, materials } = await buildThreeJSGeometryAndMaterials(morphData.processed, zenKit);

      if (!geometry) {
        return false;
      }

      // Create mesh with materials
      const morphMesh = new THREE.Mesh(geometry, materials);
      
      // Store VOB reference for click detection
      morphMesh.userData.vob = vob;

      // Apply VOB transform
      applyVobTransform(morphMesh, vob);

      // Register loaded VOB and add to scene
      if (vobId) {
        loadedVOBsRef.current.set(vobId, morphMesh);
        scene.add(morphMesh);
        console.log(`✅ Added morph mesh VOB to scene: ${vob.visual.name} at (${morphMesh.position.x.toFixed(1)}, ${morphMesh.position.y.toFixed(1)}, ${morphMesh.position.z.toFixed(1)})`);
        
        // Verify it's actually in the scene
        if (!scene.children.includes(morphMesh)) {
          console.error(`❌ ERROR: Morph mesh VOB was not added to scene! ${vob.visual.name}`);
        }
      } else {
        console.warn(`⚠️ Skipping morph mesh VOB add to scene - no vobId: ${vob.visual.name}`);
      }

      return true;

    } catch (error) {
      console.warn(`Failed to render morph mesh VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Shared function to build Three.js geometry and materials from processed mesh data
  const buildThreeJSGeometryAndMaterials = async (processed: ProcessedMeshData, zenKit: ZenKit, vobType?: number) => {
    const idxCount = processed.indices.size();
    const matCount = processed.materials.size();

    // Build Three.js geometry
    const positions = new Float32Array(idxCount * 3);
    const normals = new Float32Array(idxCount * 3);
    const uvs = new Float32Array(idxCount * 2);

    for (let i = 0; i < idxCount; i++) {
      const vertIdx = processed.indices.get(i);
      const vertBase = vertIdx * 8;

      positions[i*3 + 0] = processed.vertices.get(vertBase + 0);
      positions[i*3 + 1] = processed.vertices.get(vertBase + 1);
      positions[i*3 + 2] = processed.vertices.get(vertBase + 2);

      normals[i*3 + 0] = processed.vertices.get(vertBase + 3);
      normals[i*3 + 1] = processed.vertices.get(vertBase + 4);
      normals[i*3 + 2] = processed.vertices.get(vertBase + 5);

      uvs[i*2 + 0] = processed.vertices.get(vertBase + 6);
      uvs[i*2 + 1] = processed.vertices.get(vertBase + 7);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // Build material groups
    const triCount = processed.materialIds.size();
    geometry.clearGroups();

    let currentMatId = processed.materialIds.get(0);
    let groupStart = 0;

    for (let t = 1; t <= triCount; t++) {
      const matId = (t < triCount) ? processed.materialIds.get(t) : -1;

      if (t === triCount || matId !== currentMatId) {
        const vertexStart = groupStart * 3;
        const vertexCount = (t - groupStart) * 3;
        geometry.addGroup(vertexStart, vertexCount, currentMatId);

        groupStart = t;
        currentMatId = matId;
      }
    }

    // Build materials using cache
    const materialArray: THREE.MeshBasicMaterial[] = [];
    for (let mi = 0; mi < matCount; mi++) {
      const mat = processed.materials.get(mi);
      const material = await getMaterialCached(mat, zenKit, vobType);
      materialArray.push(material);
    }

    return { geometry, materials: materialArray };
  };

  // Cached mesh loader
  const loadMeshCached = async (meshPath: string, zenKit: ZenKit): Promise<ProcessedMeshData | null> => {
    // Check cache first
    const cached = meshCacheRef.current.get(meshPath);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(meshPath);
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load mesh with ZenKit
      const vobMesh = zenKit.createMesh();
      const isMRM = meshPath.toUpperCase().endsWith('.MRM');
      const loadResult = isMRM ? vobMesh.loadMRMFromArray(uint8Array) : vobMesh.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        return null;
      }

      // Get processed mesh data
      const meshData = vobMesh.getMeshData();
      const processed = meshData.getProcessedMeshData();

      // Check if mesh has data
      if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
        return null;
      }

      // Cache and return
      meshCacheRef.current.set(meshPath, processed);
      return processed;
    } catch (error: unknown) {
      console.warn(`Failed to load mesh ${meshPath}:`, error);
      return null;
    }
  };

  // Cached model loader for .MDL files
  const loadModelCached = async (modelPath: string, zenKit: ZenKit): Promise<Model | null> => {
    // Check cache first
    const cached = modelCacheRef.current.get(modelPath);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(modelPath);
      
      // Check if .MDL doesn't exist (404 or returns HTML)
      const contentType = response.headers.get('content-type') || '';
      const is404 = !response.ok || contentType.includes('text/html');
      
      if (is404) {
        // Try loading .MDH and .MDM separately
        const basePath = modelPath.replace(/\.MDL$/i, '');
        const mdhPath = `${basePath}.MDH`;
        const mdmPath = `${basePath}.MDM`;
        
        try {
          // Load hierarchy (.MDH)
          const mdhResponse = await fetch(mdhPath);
          if (!mdhResponse.ok) {
            return null;
          }
          
          const mdhArrayBuffer = await mdhResponse.arrayBuffer();
          const mdhUint8Array = new Uint8Array(mdhArrayBuffer);
          
          const hierarchyLoader = zenKit.createModelHierarchyLoader();
          const mdhLoadResult = hierarchyLoader.loadFromArray(mdhUint8Array);
          
          if (!mdhLoadResult || !mdhLoadResult.success) {
            return null;
          }
          
          // Load mesh (.MDM)
          const mdmResponse = await fetch(mdmPath);
          if (!mdmResponse.ok) {
            return null;
          }
          
          const mdmArrayBuffer = await mdmResponse.arrayBuffer();
          const mdmUint8Array = new Uint8Array(mdmArrayBuffer);
          
          const meshLoader = zenKit.createModelMeshLoader();
          const mdmLoadResult = meshLoader.loadFromArray(mdmUint8Array);
          
          if (!mdmLoadResult || !mdmLoadResult.success) {
            return null;
          }
          
          // Combine hierarchy and mesh into a Model
          const model = zenKit.createModel();
          model.setHierarchy(hierarchyLoader.getHierarchy());
          model.setMesh(meshLoader.getMesh());
          
          // Cache and return
          modelCacheRef.current.set(modelPath, model);
          return model;
          
        } catch (error: unknown) {
          return null;
        }
      }

      // Load .MDL file normally
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load model with ZenKit
      const model = zenKit.createModel();
      const loadResult = model.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        console.warn(`Failed to load model ${modelPath}:`, model.getLastError());
        return null;
      }

      // Check for attachments FIRST, before checking isLoaded
      const attachmentNames = model.getAttachmentNames();
      const hasAttachments = attachmentNames && attachmentNames.size && attachmentNames.size() > 0;

      // Only reject if BOTH isLoaded is false AND there are no attachments
      if (!model.isLoaded && !hasAttachments) {
        return null;
      }

      // Cache and return
      modelCacheRef.current.set(modelPath, model);
      return model;
    } catch (error: unknown) {
      console.warn(`Failed to load model ${modelPath}:`, error);
      return null;
    }
  };

  // Cached morph mesh loader for .MMB files
  const loadMorphMeshCached = async (morphPath: string, zenKit: ZenKit): Promise<{ morphMesh: MorphMesh; processed: ProcessedMeshData; animations: string[] } | null> => {
    // Check cache first
    const cached = morphMeshCacheRef.current.get(morphPath);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(morphPath);
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load morph mesh with ZenKit
      const morphMesh = zenKit.createMorphMesh();
      const loadResult = morphMesh.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        console.warn(`Failed to load morph mesh ${morphPath}:`, morphMesh.getLastError());
        return null;
      }

      if (!morphMesh.isLoaded) {
        console.warn(`Morph mesh ${morphPath} loaded but reports not loaded`);
        return null;
      }

      // Get processed mesh data for rendering
      const processed = morphMesh.convertToProcessedMesh();
      const animationNames = morphMesh.getAnimationNames();
      const animationCount = animationNames.size();
      const animations: string[] = [];
      for (let i = 0; i < animationCount; i++) {
        animations.push(animationNames.get(i));
      }

      const result = {
        morphMesh: morphMesh,
        processed: processed,
        animations: animations
      };

      // Cache and return
      morphMeshCacheRef.current.set(morphPath, result);
      console.log(`✅ Loaded morph mesh ${morphPath} (${animationCount} animations available)`);
      return result;
    } catch (error: unknown) {
      console.warn(`Failed to load morph mesh ${morphPath}:`, error);
      return null;
    }
  };

  // Cached texture loader
  const loadTextureCached = async (texturePath: string, zenKit: ZenKit): Promise<THREE.DataTexture | null> => {
    // Check cache first
    const cached = textureCacheRef.current.get(texturePath);
    if (cached) {
      return cached;
    }

    try {
      const tex = await loadCompiledTexAsDataTexture(texturePath, zenKit);
      if (tex) {
        textureCacheRef.current.set(texturePath, tex);
      }
      return tex;
    } catch (error) {
      return null;
    }
  };

  // Color name to hex mapping for spot VOBs (matching original Spacer editor)
  const colorNameToHex: { [key: string]: number } = {
    'RED': 0xFF0000,
    'GREEN': 0x00FF00,
    'BLUE': 0x0000FF,
    'YELLOW': 0xFFFF00,
    'ORANGE': 0xFFA500,
    'PURPLE': 0x800080,
    'CYAN': 0x00FFFF,
    'MAGENTA': 0xFF00FF,
    'WHITE': 0xFFFFFF,
    'BLACK': 0x000000,
    'GRAY': 0x808080,
    'GREY': 0x808080,
  };

  // Cached material creator
  const getMaterialCached = async (materialData: { texture: string; name?: string }, zenKit: ZenKit, vobType?: number): Promise<THREE.MeshBasicMaterial> => {
    const textureName = materialData.texture || '';
    const materialName = materialData.name || '';
    const isSpotVob = vobType === 11;

    // For spot VOBs: check if material name is a color name (no texture)
    if (isSpotVob && !textureName && materialName) {
      const colorHex = colorNameToHex[materialName.toUpperCase()];
      const cacheKey = `SPOT_COLOR_${materialName}`;
      
      // Check cache first
      const cached = materialCacheRef.current.get(cacheKey);
      if (cached && cached instanceof THREE.MeshBasicMaterial) {
        return cached;
      }

      // Create solid color material for spot VOB
      const material = new THREE.MeshBasicMaterial({
        color: colorHex !== undefined ? colorHex : 0xFFFFFF, // Default to white if color not found
        side: THREE.DoubleSide,
        transparent: false,
        alphaTest: 0.5
      });

      // Cache and return
      materialCacheRef.current.set(cacheKey, material);
      return material;
    }

    // Regular texture-based material (for non-spot VOBs or spot VOBs with textures)
    // Check cache first
    const cached = materialCacheRef.current.get(textureName);
    if (cached && cached instanceof THREE.MeshBasicMaterial) {
      return cached;
    }

    // Create material
    const material = new THREE.MeshBasicMaterial({
      color: 0xFFFFFF,
      side: THREE.DoubleSide,
      transparent: false,  // Disable transparency for alpha-tested materials
      alphaTest: 0.5       // Use proper alpha test threshold like OpenGothic
    });

    // Load texture if available
    if (textureName && textureName.length) {
      const url = tgaNameToCompiledUrl(textureName);
      if (url) {
        const tex = await loadTextureCached(url, zenKit);
        if (tex) {
          material.map = tex;
          material.needsUpdate = true;
        }
      }
    }

    // Cache and return
    materialCacheRef.current.set(textureName, material);
    return material;
  };

  // Helper function to apply VOB transform to an object
  const applyVobTransform = (object: THREE.Object3D, vob: Vob) => {
    // Apply VOB transform using OpenGothic's approach
    // rotation.toArray() returns an Emscripten FloatArrayLike object
    const rotArray = vob.rotation.toArray();
    
    // Extract rotation matrix values from Emscripten TypedArrayLike
    const m: number[] = [];
    for (let i = 0; i < rotArray.size(); i++) {
      m.push(rotArray.get(i));
    }

    // Build transform matrix exactly like OpenGothic does
    const transformMat = new THREE.Matrix4();
    transformMat.set(
      -m[0], -m[3], -m[6], -vob.position.x,  // Negate X components for mirroring
       m[1],  m[4],  m[7],  vob.position.y,
       m[2],  m[5],  m[8],  vob.position.z,
      0, 0, 0, 1
    );

    // Decompose matrix into position, quaternion, scale for Three.js
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    transformMat.decompose(pos, quat, scale);

    object.position.copy(pos);
    object.quaternion.copy(quat);
    object.scale.copy(scale);
  };

  // Helper function to load compiled TEX file as DataTexture
  const loadCompiledTexAsDataTexture = async (url: string | null, zenKit: ZenKit): Promise<THREE.DataTexture | null> => {
    if (!url) return null;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;

      const buf = await res.arrayBuffer();
      const arr = new Uint8Array(buf);

      const zkTex = new zenKit.Texture();
      const ok = zkTex.loadFromArray(arr);
      if (!ok || !ok.success) return null;

      const w = zkTex.width;
      const h = zkTex.height;
      const rgba = zkTex.asRgba8(0);
      if (!rgba) return null;

      const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
      tex.needsUpdate = true;
      tex.flipY = false;  // OpenGothic doesn't flip Y
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;  // Enable some anisotropy for better quality
      // IMPORTANT: world UVs frequently exceed [0,1]; enable tiling
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;

      return tex;
    } catch (error) {
      return null;
    }
  };



  const [selectedVobObject, setSelectedVobObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!selectedVob) {
      setSelectedVobObject(null);
      return;
    }

    const vobData = allVOBsRef.current.find(vd => vd.vob.id === selectedVob.id);
    if (!vobData) {
      setSelectedVobObject(null);
      return;
    }

    const renderedObject = loadedVOBsRef.current.get(vobData.id);
    if (renderedObject) {
      setSelectedVobObject(renderedObject);
    } else {
      setSelectedVobObject(null);
      
      if (!loadingVOBsRef.current.has(vobData.id)) {
        loadingVOBsRef.current.add(vobData.id);
        renderVOB(vobData.vob, vobData.id, vobData).then(success => {
          loadingVOBsRef.current.delete(vobData.id);
          if (success) {
            const loadedObj = loadedVOBsRef.current.get(vobData.id);
            if (loadedObj) {
              setSelectedVobObject(loadedObj);
            }
          }
        });
      }
    }
  }, [selectedVob]);

  useEffect(() => {
    if (!selectedVobObject || !onSelectedVobBoundingBox) {
      return;
    }

    const timeoutId = setTimeout(() => {
      selectedVobObject.updateMatrixWorld(true);

      const box = new THREE.Box3();
      box.setFromObject(selectedVobObject);

      if (box.isEmpty()) {
        return;
      }

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      if (size.x > 0 && size.y > 0 && size.z > 0) {
        onSelectedVobBoundingBox(center, size);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedVobObject, onSelectedVobBoundingBox]);

  // Objects are added directly to the scene, but we can return JSX for the bounding box
  return (
    <>
      {selectedVobObject && (
        <VOBBoundingBox
          vobObject={selectedVobObject}
          visible={true}
          color="#ffff00"
        />
      )}
    </>
  );
}

export { VOBRenderer };
