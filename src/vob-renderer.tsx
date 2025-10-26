import { useRef, useEffect, useState } from "react";
import * as THREE from "three";

// VOB Renderer Component - loads and renders Virtual Object Bases (VOBs)
function VOBRenderer({ world, zenKit, onLoadingStatus }: Readonly<{
  world: any;
  zenKit: any;
  onLoadingStatus: (status: string) => void;
}>) {
  const [vobObjects, setVobObjects] = useState<THREE.Object3D[]>([]);
  const hasLoadedRef = useRef(false);

  // VOB management state
  const loadedVOBsRef = useRef(new Map()); // vob id -> THREE.Mesh/Object3D
  const allVOBsRef = useRef<any[]>([]); // All VOB data from world
  const lastCameraPositionRef = useRef(new THREE.Vector3());
  const VOB_LOAD_DISTANCE = 5000; // Load VOBs within this distance
  const VOB_UNLOAD_DISTANCE = 6000; // Unload VOBs beyond this distance

  // Asset caches to avoid reloading
  const meshCacheRef = useRef(new Map()); // path -> processed mesh data
  const textureCacheRef = useRef(new Map()); // path -> THREE.DataTexture
  const materialCacheRef = useRef(new Map()); // texture path -> THREE.Material
  const modelCacheRef = useRef(new Map()); // path -> ZenKit Model instance
  const morphMeshCacheRef = useRef(new Map()); // path -> { morphMesh, processed, animations }

  // Streaming loader state
  const vobLoadQueueRef = useRef<any[]>([]);
  const isLoadingVOBRef = useRef(false);
  const isFirstVOBUpdateRef = useRef(true);

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
        requestAnimationFrame(updateVOBStreaming);

      } catch (error) {
        console.error('❌ Failed to load VOBs:', error);
        onLoadingStatus(`❌ Failed to load VOBs: ${(error as Error).message}`);
      }
    };

    loadVOBs();
  }, [world, zenKit, onLoadingStatus]);

  // Collect VOB data from world
  const collectVOBs = async (world: any) => {
    const vobs = world.getVobs();
    const vobCount = vobs.size();
    console.log(`Found ${vobCount} root VOBs`);

    let totalCount = 0;
    const visualTypeCounts: { [key: string]: number } = {};

    // Recursive function to collect VOB data
    function collectVobTree(vob: any, vobId = 0) {
      totalCount++;

      // Track visual type statistics
      const typeKey = `Type_${vob.visual.type}`;
      visualTypeCounts[typeKey] = (visualTypeCounts[typeKey] || 0) + 1;

      // Only store VOBs that have visible meshes
      if (vob.showVisual && vob.visual.name &&
          (vob.visual.type === 1 || vob.visual.type === 2 || vob.visual.type === 5 || vob.visual.type === 6) &&
          !vob.visual.name.toUpperCase().endsWith('.TEX') &&
          !vob.visual.name.toUpperCase().endsWith('.TGA')) {

          allVOBsRef.current.push({
            id: `${vobId}_${totalCount}`,
            vob: vob,
            position: new THREE.Vector3(-vob.position.x, vob.position.y, vob.position.z),
            visualName: vob.visual.name
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
    // Get current camera position (we'll need to pass this from parent)
    // For now, we'll use a default camera position
    const camPos = new THREE.Vector3(0, 0, 0); // This should be passed from camera controls

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
          // Remove from scene (handled by React state)
          loadedVOBsRef.current.delete(id);
        }
      }

      // Sort queue by distance (closest first)
      vobLoadQueueRef.current.sort((a, b) => {
        return camPos.distanceTo(a.position) - camPos.distanceTo(b.position);
      });
    }

    // Load one VOB per frame to avoid lag
    if (!isLoadingVOBRef.current && vobLoadQueueRef.current.length > 0) {
      isLoadingVOBRef.current = true;
      const vobData = vobLoadQueueRef.current.shift();

      renderVOB(vobData.vob, vobData.id).then(success => {
        isLoadingVOBRef.current = false;
        if (success) {
          console.log(`✅ Loaded VOB: ${vobData.visualName}`);
        }
      });
    }

    // Update debug info
    const loadedCount = loadedVOBsRef.current.size;
    const totalCount = allVOBsRef.current.length;
    const queueCount = vobLoadQueueRef.current.length;

    // Continue streaming
    requestAnimationFrame(updateVOBStreaming);
  };

  // Main VOB rendering dispatcher
  const renderVOB = async (vob: any, vobId = null): Promise<boolean> => {
    // Skip if no visual or visual disabled
    if (!vob.showVisual || !vob.visual.name) {
      return false;
    }

    const visualName = vob.visual.name;

    // Only render mesh visuals
    // Type 0 = DECAL (sprite/texture, not 3D mesh)
    // Type 1 = MESH (static 3D mesh)
    // Type 2 = MULTI_RESOLUTION_MESH (LOD mesh)
    // Type 3 = PARTICLE_EFFECT, 4 = AI_CAMERA, 5 = MODEL, 6 = MORPH_MESH
    if (vob.visual.type !== 1 && vob.visual.type !== 2 && vob.visual.type !== 5 && vob.visual.type !== 6) {
      return false; // Skip non-mesh visuals (decals, particles, etc.)
    }

    // Skip if visual name has texture extension (indicates it's not a mesh)
    if (visualName.toUpperCase().endsWith('.TEX') || visualName.toUpperCase().endsWith('.TGA')) {
      return false;
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

      return await renderMeshVOB(vob, vobId, meshPath);
    }
  };

  // Render mesh VOB
  const renderMeshVOB = async (vob: any, vobId: string | null, meshPath: string): Promise<boolean> => {
    try {
      // Load mesh with caching
      const processed = await loadMeshCached(meshPath, zenKit);
      if (!processed) {
        return false;
      }

      // Build Three.js geometry and materials
      const { geometry, materials } = await buildThreeJSGeometryAndMaterials(processed, zenKit);

      // Create mesh
      const vobMeshObj = new THREE.Mesh(geometry, materials);

      // Apply VOB transform
      applyVobTransform(vobMeshObj, vob);

      // Register loaded VOB
      if (vobId) {
        loadedVOBsRef.current.set(vobId, vobMeshObj);
        setVobObjects(prev => [...prev, vobMeshObj]);
      }

      return true;

    } catch (error) {
      console.warn(`Failed to render mesh VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Render model VOB
  const renderModelVOB = async (vob: any, vobId: string | null): Promise<boolean> => {
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

      // For now, render all attachments as a group
      const attachmentNames = model.getAttachmentNames();

      if (attachmentNames.size() === 0) {
        console.log(`Model ${modelPath} has no attachments to render`);
        return false;
      }

      // Get the model hierarchy to position attachments correctly
      const hierarchy = model.getHierarchy();

      // Create a group to hold all attachment meshes
      const modelGroup = new THREE.Group();

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
      for (let i = 0; i < attachmentNames.size(); i++) {
        const attachmentName = attachmentNames.get(i);
        const attachment = model.getAttachment(attachmentName);
        if (!attachment) continue;

        // Find the corresponding hierarchy node for this attachment
        let hierarchyNodeIndex = -1;
        const nodeCount = hierarchy.nodes.size ? hierarchy.nodes.size() : hierarchy.nodes.length;
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
        } else {
          console.warn(`No hierarchy node found for attachment: ${attachmentName}`);
        }

        modelGroup.add(attachmentMesh);
      }

      // Apply VOB transform using the same approach as regular VOBs
      applyVobTransform(modelGroup, vob);

      // Register loaded VOB
      if (vobId) {
        loadedVOBsRef.current.set(vobId, modelGroup);
        setVobObjects(prev => [...prev, modelGroup]);
      }

      return true;

    } catch (error) {
      console.warn(`Failed to render model VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Render morph mesh VOB
  const renderMorphMeshVOB = async (vob: any, vobId: string | null): Promise<boolean> => {
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

      // Apply VOB transform
      applyVobTransform(morphMesh, vob);

      // Register loaded VOB
      if (vobId) {
        loadedVOBsRef.current.set(vobId, morphMesh);
        setVobObjects(prev => [...prev, morphMesh]);
      }

      console.log(`✅ Rendered morph mesh VOB ${visualName} (${morphData.animationCount} animations available)`);

      return true;

    } catch (error) {
      console.warn(`Failed to render morph mesh VOB ${vob.visual.name}:`, error);
      return false;
    }
  };

  // Shared function to build Three.js geometry and materials from processed mesh data
  const buildThreeJSGeometryAndMaterials = async (processed: any, zenKit: any) => {
    const vertCount = processed.vertices.size();
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
      const material = await getMaterialCached(mat, zenKit);
      materialArray.push(material);
    }

    return { geometry, materials: materialArray };
  };

  // Cached mesh loader
  const loadMeshCached = async (meshPath: string, zenKit: any) => {
    // Check cache first
    if (meshCacheRef.current.has(meshPath)) {
      return meshCacheRef.current.get(meshPath);
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
    } catch (error) {
      console.warn(`Failed to load mesh ${meshPath}:`, error);
      return null;
    }
  };

  // Cached model loader for .MDL files
  const loadModelCached = async (modelPath: string, zenKit: any) => {
    // Check cache first
    if (modelCacheRef.current.has(modelPath)) {
      return modelCacheRef.current.get(modelPath);
    }

    try {
      const response = await fetch(modelPath);
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load model with ZenKit
      const model = zenKit.createModel();
      const loadResult = model.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        console.warn(`Failed to load model ${modelPath}:`, model.getLastError());
        return null;
      }

      if (!model.isLoaded) {
        console.warn(`Model ${modelPath} loaded but reports not loaded`);
        return null;
      }

      // Cache and return
      modelCacheRef.current.set(modelPath, model);
      console.log(`✅ Loaded model ${modelPath}`);
      return model;
    } catch (error) {
      console.warn(`Failed to load model ${modelPath}:`, error);
      return null;
    }
  };

  // Cached morph mesh loader for .MMB files
  const loadMorphMeshCached = async (morphPath: string, zenKit: any) => {
    // Check cache first
    if (morphMeshCacheRef.current.has(morphPath)) {
      return morphMeshCacheRef.current.get(morphPath);
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

      const result = {
        morphMesh: morphMesh,
        processed: processed,
        animationCount: animationCount
      };

      // Cache and return
      morphMeshCacheRef.current.set(morphPath, result);
      console.log(`✅ Loaded morph mesh ${morphPath} (${animationCount} animations available)`);
      return result;
    } catch (error) {
      console.warn(`Failed to load morph mesh ${morphPath}:`, error);
      return null;
    }
  };

  // Cached texture loader
  const loadTextureCached = async (texturePath: string, zenKit: any): Promise<THREE.DataTexture | null> => {
    // Check cache first
    if (textureCacheRef.current.has(texturePath)) {
      return textureCacheRef.current.get(texturePath);
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

  // Cached material creator
  const getMaterialCached = async (materialData: any, zenKit: any): Promise<THREE.MeshBasicMaterial> => {
    const textureName = materialData.texture || '';

    // Check cache first
    if (materialCacheRef.current.has(textureName)) {
      return materialCacheRef.current.get(textureName);
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
      const tex = await loadTextureCached(url, zenKit);
      if (tex) {
        material.map = tex;
        material.needsUpdate = true;
      }
    }

    // Cache and return
    materialCacheRef.current.set(textureName, material);
    return material;
  };

  // Helper function to apply VOB transform to an object
  const applyVobTransform = (object: THREE.Object3D, vob: any) => {
    // Apply VOB transform using OpenGothic's approach
    const rotArray = vob.rotation.toArray();
    const m = [];
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
  const loadCompiledTexAsDataTexture = async (url: string | null, zenKit: any): Promise<THREE.DataTexture | null> => {
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

  // Helper function to convert TGA texture name to compiled TEX URL
  const tgaNameToCompiledUrl = (name: string): string | null => {
    if (!name || typeof name !== 'string') return null;
    const base = name.replace(/\.[^.]*$/, '').toUpperCase();
    return `/TEXTURES/_COMPILED/${base}-C.TEX`;
  };

  // Path resolution functions
  const getMeshPath = (visualName: string): string | null => {
    if (!visualName || typeof visualName !== 'string') return null;

    const upper = visualName.toUpperCase();

    // Remove extension and get base name
    const base = upper.replace(/\.(3DS|MMS|ASC|TGA)$/i, '');

    // Meshes don't have -C suffix like textures do
    // Try .MRM (Multi-Resolution Mesh) first, then .MSH
    const possiblePaths = [
      `/MESHES/_COMPILED/${base}.MRM`,
      `/MESHES/_COMPILED/${base}.MSH`,
    ];

    // For now, return the first possibility (we'll check existence in fetch)
    return possiblePaths[0];
  };

  const getModelPath = (visualName: string): string | null => {
    if (!visualName || typeof visualName !== 'string') return null;

    const upper = visualName.toUpperCase();

    // Remove extension if present and get base name
    const base = upper.replace(/\.(MDL|MDS|3DS|MMS|ASC|TGA)$/i, '');

    // Interactive models are stored in ANIMS/_COMPILED folder as .MDL files
    const modelPath = `/ANIMS/_COMPILED/${base}.MDL`;

    return modelPath;
  };

  const getMorphMeshPath = (visualName: string): string | null => {
    if (!visualName || typeof visualName !== 'string') return null;

    const upper = visualName.toUpperCase();

    // Remove extension if present and get base name
    const base = upper.replace(/\.(MMB|MMS|MMSB|MDS|3DS|ASC|TGA)$/i, '');

    // Morph meshes are stored in ANIMS/_COMPILED folder as .MMB files
    const morphPath = `/ANIMS/_COMPILED/${base}.MMB`;

    return morphPath;
  };

  return (
    <>
      {vobObjects.map((vobObject, index) => (
        <primitive key={index} object={vobObject} />
      ))}
    </>
  );
}

export { VOBRenderer };
