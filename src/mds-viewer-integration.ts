import * as THREE from "three";
import type { ZenKit } from '@kolarz3/zenkit';

// MDS Viewer Integration - wraps functionality from mds-viewer.html
export class MDSViewerIntegration {
  // @ts-ignore - unused for now, will be used in future UI integration
  private ZenKit: ZenKit | null = null;
  // @ts-ignore - unused for now, will be used in future UI integration
  private scene: THREE.Scene | null = null;
  // @ts-ignore - unused for now, will be used in future UI integration
  private camera: THREE.Camera | null = null;
  // @ts-ignore - unused for now, will be used in future UI integration
  private renderer: THREE.WebGLRenderer | null = null;
  // @ts-ignore - unused for now, will be used in future UI integration
  private modelMesh: THREE.Group | null = null;
  // @ts-ignore - unused for now, will be used in future UI integration
  private characterMesh: THREE.Mesh | null = null;
  // @ts-ignore - unused for now, will be used in future UI integration
  private skinnedMeshes: THREE.Mesh[] = [];
  // @ts-ignore - unused for now, will be used in future UI integration
  private skeleton: any = null; // Custom Skeleton class instance
  // @ts-ignore - unused for now, will be used in future UI integration
  private animation: any = null; // Custom Animation class instance
  // @ts-ignore - unused for now, will be used in future UI integration
  private poseEvaluator: any = null; // PoseEvaluator from ZenKit (WASM)
  // @ts-ignore - unused for now, will be used in future UI integration
  private currentAnimTimeMs: number = 0; // Current animation time in ms
  // @ts-ignore - unused for now, will be used in future UI integration
  private isAnimPlaying: boolean = false;
  // @ts-ignore - unused for now, will be used in future UI integration
  private isAnimLooping: boolean = false;
  // @ts-ignore - unused for now, will be used in future UI integration
  private DEFAULT_RUN_SEQUENCE = ['t_Run_2_RunL', 's_RunL', 't_RunL_2_Run'];
  // @ts-ignore - unused for now, will be used in future UI integration
  private DEFAULT_MDS = 'HumanS.mds';
  // @ts-ignore - unused for now, will be used in future UI integration
  private DEFAULT_OVERLAY = null; // No default overlay
  // @ts-ignore - unused for now, will be used in future UI integration
  private currentMdsBaseName = 'HumanS'; // Store the MDS base name (from MDS file)
  // @ts-ignore - unused for now, will be used in future UI integration
  private currentSkeletonBaseName = ''; // Store current skeleton base for render
  // @ts-ignore - unused for now, will be used in future UI integration
  private overlayAnimations: any[] = []; // Animations from overlay MDS (with source base)
  // @ts-ignore - unused for now, will be used in future UI integration
  private overlayDisabled: string[] = []; // Disabled animations from overlay
  // @ts-ignore - unused for now, will be used in future UI integration
  private headMeshesAvailable: boolean | null = null; // Unknown; set false if assets missing
  // @ts-ignore - unused for now, will be used in future UI integration
  private headNodeIndex: number = -1; // Index of the head bone in the skeleton
  // @ts-ignore - unused for now, will be used in future UI integration
  private skeletonHelper: THREE.SkeletonHelper | null = null; // Visualize bones
  // @ts-ignore - unused for now, will be used in future UI integration
  private activeMeshName: string | null = null; // Currently selected mesh to load (null = default from MDS)
  // @ts-ignore - unused for now, will be used in future UI integration
  private activeHeadName: string | null = null; // Currently selected head (null = auto-detect)
  // @ts-ignore - unused for now, will be used in future UI integration
  private showFemaleHeads: boolean = false; // Toggle between male/female head lists
  // @ts-ignore - unused for now, will be used in future UI integration
  private animationSequence: any[] = []; // Queue of animations to play in sequence
  // @ts-ignore - unused for now, will be used in future UI integration
  private isPlayingSequence: boolean = false; // Whether we're currently playing a sequence

  // Available head models
  // @ts-ignore - unused for now, will be used in future UI integration
  private MALE_HEADS = [
    'HUM_HEAD_BALD',
    'HUM_HEAD_FATBALD',
    'HUM_HEAD_FIGHTER',
    'HUM_HEAD_PONY',
    'HUM_HEAD_PSIONIC',
    'HUM_HEAD_THIEF'
  ];

  // @ts-ignore - unused for now, will be used in future UI integration
  private FEMALE_HEADS = [
    'HUM_HEAD_BABE',
    'HUM_HEAD_BABE1',
    'HUM_HEAD_BABE2',
    'HUM_HEAD_BABE3',
    'HUM_HEAD_BABE4',
    'HUM_HEAD_BABE5',
    'HUM_HEAD_BABE6',
    'HUM_HEAD_BABE7',
    'HUM_HEAD_BABE8'
  ];

  // Asset caches
  // @ts-ignore - unused for now, will be used in future UI integration
  private meshCache = new Map();
  // @ts-ignore - unused for now, will be used in future UI integration
  private textureCache = new Map();
  // @ts-ignore - unused for now, will be used in future UI integration
  private materialCache = new Map();
  // @ts-ignore - unused for now, will be used in future UI integration
  private modelCache = new Map();
  // @ts-ignore - unused for now, will be used in future UI integration
  private animationCache = new Map();

  // Camera control variables
  // @ts-ignore - unused for now, will be used in future UI integration
  private moveSpeed: number = 10;
  // @ts-ignore - unused for now, will be used in future UI integration
  private mouseSensitivity: number = 0.002;
  // @ts-ignore - unused for now, will be used in future UI integration
  private pitch: number = 0;
  // @ts-ignore - unused for now, will be used in future UI integration
  private yaw: number = 0;
  // @ts-ignore - unused for now, will be used in future UI integration
  private velocity: THREE.Vector3 = new THREE.Vector3();
  // @ts-ignore - unused for now, will be used in future UI integration
  private isMouseDown: boolean = false;
  // @ts-ignore - unused for now, will be used in future UI integration
  private lastMouseX: number = 0;
  // @ts-ignore - unused for now, will be used in future UI integration
  private lastMouseY: number = 0;

  constructor(zenKit: ZenKit, scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this.ZenKit = zenKit;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
  }

  // Skeleton class from mds-viewer.html
  private Skeleton = class {
    nodes: any[] = [];
    rootNodes: number[] = [];
    bones: THREE.Bone[] = [];
    rootTr: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    bindLocal: THREE.Matrix4[] = [];
    bindWorld: THREE.Matrix4[] = [];
    animWorld: THREE.Matrix4[] = [];
    threeSkeleton: THREE.Skeleton | null = null;

    constructor(hierarchy: any) {
      const nodeCount = hierarchy.nodes.size();
      const rt = hierarchy.rootTranslation;
      this.rootTr = { x: rt.x, y: rt.y, z: rt.z };

      // 1. Create Bones
      for (let i = 0; i < nodeCount; i++) {
        const node = hierarchy.nodes.get(i);
        const parentIdx = node.parentIndex;

        const bone = new THREE.Bone();
        bone.name = node.name;
        this.bones.push(bone);

        this.nodes.push({
          parent: parentIdx === -1 ? -1 : parentIdx,
          transform: node.getTransform(),
          name: node.name
        });
      }

      // 2. Build Hierarchy
      for (let i = 0; i < this.nodes.length; i++) {
        const parentIdx = this.nodes[i].parent;
        if (parentIdx === -1) {
          this.rootNodes.push(i);
        } else {
          this.bones[parentIdx].add(this.bones[i]);
        }
      }

      // 3. Set Initial Bind Pose (Local Transforms)
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        const bone = this.bones[i];

        const mat = this.matrix4x4DataToMatrix4(node.transform);

        // Apply root translation to root bones (once, like native engine bind)
        if (node.parent === -1) {
          mat.elements[12] += this.rootTr.x;
          mat.elements[13] += this.rootTr.y;
          mat.elements[14] += this.rootTr.z;
        }

        // Decompose matrix to pos/quat/scale
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        mat.decompose(pos, quat, scale);

        bone.position.copy(pos);
        bone.quaternion.copy(quat);
        bone.scale.copy(scale);

        this.bindLocal[i] = mat.clone();
      }

      // 4. Compute bind-pose world matrices
      for (let i = 0; i < this.nodes.length; i++) {
        const parentIdx = this.nodes[i].parent;
        if (parentIdx >= 0) {
          this.bindWorld[i] = new THREE.Matrix4().multiplyMatrices(this.bindWorld[parentIdx], this.bindLocal[i]);
        } else {
          this.bindWorld[i] = this.bindLocal[i].clone();
        }
      }
      this.animWorld = this.bindWorld.map(m => m.clone());

      // 5. Compute bind-pose inverses (still stored for compatibility)
      for (const rootIdx of this.rootNodes) {
        this.bones[rootIdx].updateMatrixWorld(true);
      }
      const boneInverses: THREE.Matrix4[] = [];
      for (let i = 0; i < this.bones.length; i++) {
        const inv = new THREE.Matrix4();
        inv.copy(this.bones[i].matrixWorld).invert();
        boneInverses.push(inv);
      }

      this.threeSkeleton = new THREE.Skeleton(this.bones, boneInverses);
    }

    matrix4x4DataToMatrix4(mat4Data: any) {
      const m = new THREE.Matrix4();
      const te = m.elements;
      for (let i = 0; i < 16; i++) {
        te[i] = mat4Data.get(i);
      }
      return m;
    }
  };

  // AnimationSequence class from mds-viewer.html
  private AnimationSequence = class {
    name: string;
    samples: any[] = [];
    nodeIndex: number[] = [];
    numFrames: number = 0;
    fpsRate: number = 25.0;
    animCls: string = 'Transition';
    flags: number = 0;

    constructor(manData: any, mdsAnimation: any) {
      this.name = manData.name;
      this.samples = [];
      this.nodeIndex = [];
      this.numFrames = manData.getFrameCount ? manData.getFrameCount() : 0;
      this.fpsRate = manData.getFps ? manData.getFps() : 25.0;
      this.animCls = 'Transition';
      this.flags = mdsAnimation ? mdsAnimation.flags : 0;

      // Copy node indices using getNodeIndex method
      const nodeIdxCount = manData.getNodeCount ? manData.getNodeCount() : 0;
      for (let i = 0; i < nodeIdxCount; i++) {
        this.nodeIndex.push(manData.getNodeIndex(i));
      }

      // Copy samples using getSample(frameIndex, nodeIndex) method
      for (let frameIdx = 0; frameIdx < this.numFrames; frameIdx++) {
        for (let nodeIdx = 0; nodeIdx < nodeIdxCount; nodeIdx++) {
          const sample = manData.getSample(frameIdx, nodeIdx);
          if (sample && sample.position && sample.rotation) {
            this.samples.push({
              position: { x: sample.position.x, y: sample.position.y, z: sample.position.z },
              rotation: { x: sample.rotation.x, y: sample.rotation.y, z: sample.rotation.z, w: sample.rotation.w }
            });
          } else {
            // Fallback: create default sample
            this.samples.push({
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 }
            });
          }
        }
      }

      if (mdsAnimation && mdsAnimation.next === mdsAnimation.name) {
        this.animCls = 'Loop';
      }
    }

    totalTime() {
      return (this.numFrames * 1000.0) / this.fpsRate;
    }
  };

  // Animation class from mds-viewer.html
  private Animation = class {
    sequences = new Map<string, any>();

    addSequence(name: string, sequence: any) {
      this.sequences.set(name.toUpperCase(), sequence);
    }

    sequence(name: string) {
      return this.sequences.get(name.toUpperCase());
    }
  };

  // Pose evaluation function from mds-viewer.html
  // @ts-ignore - unused for now, will be used in future animation integration
  private updatePoseFromEvaluator(deltaTime: number) {
    if (!this.poseEvaluator || !this.skeleton) {
      return false;
    }

    if (!this.poseEvaluator.hasAnimation()) {
      return false;
    }

    const totalTime = this.poseEvaluator.getTotalTimeMs();
    if (totalTime <= 0) {
      return false;
    }

    this.currentAnimTimeMs += deltaTime;

    if (this.isAnimLooping) {
      if (this.currentAnimTimeMs < 0 || this.currentAnimTimeMs >= totalTime) {
        this.currentAnimTimeMs = this.currentAnimTimeMs % totalTime;
      }
    } else {
      if (this.currentAnimTimeMs >= totalTime) {
        this.currentAnimTimeMs = totalTime;
        this.isAnimPlaying = false;
      }
      if (this.currentAnimTimeMs < 0) {
        this.currentAnimTimeMs = 0;
      }
    }

    const samples = this.poseEvaluator.evaluate(this.currentAnimTimeMs, this.isAnimLooping);
    if (!samples || !Array.isArray(samples) || samples.length === 0) {
      return false;
    }

    const nodeCount = this.skeleton.nodes.length;
    const animLocal = new Array(nodeCount);
    const animWorld = new Array(nodeCount);

    // Start from bind pose
    for (let i = 0; i < nodeCount; i++) {
      animLocal[i] = this.skeleton.bindLocal[i].clone();
    }

    // Apply samples per animated node index
    const nodeIndexCount = this.poseEvaluator.getNodeIndexCount();
    for (let i = 0; i < nodeIndexCount; i++) {
      const nodeId = this.poseEvaluator.getNodeIndex(i);
      if (nodeId < 0 || nodeId >= nodeCount) {
        continue;
      }

      const sample = samples[i];
      if (!sample) continue;

      const pos = new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z);
      let rot = new THREE.Quaternion(sample.rotation.x, sample.rotation.y, sample.rotation.z, sample.rotation.w);

      // Gothic (LH) -> Three.js (RH): conjugate quaternion
      rot = new THREE.Quaternion(-rot.x, -rot.y, -rot.z, rot.w);

      animLocal[nodeId] = new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(1, 1, 1));
    }

    // Build world matrices
    for (let i = 0; i < nodeCount; i++) {
      const parentIdx = this.skeleton.nodes[i].parent;
      if (parentIdx >= 0) {
        animWorld[i] = new THREE.Matrix4().multiplyMatrices(animWorld[parentIdx], animLocal[i]);
      } else {
        animWorld[i] = animLocal[i].clone();
      }
    }

            // Apply to bones for visualization
    for (let i = 0; i < nodeCount; i++) {
      const bone = this.skeleton.bones[i];
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      animLocal[i].decompose(pos, quat, scl);
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
      bone.scale.copy(scl);
    }

    this.skeleton.animWorld = animWorld;

    for (const rootIdx of this.skeleton.rootNodes) {
      this.skeleton.bones[rootIdx].updateMatrixWorld(true);
    }

    if (this.skeletonHelper && typeof this.skeletonHelper.update === 'function') {
      this.skeletonHelper.update();
    }

    return true;
  }

  /**
   * Apply CPU skinning - transforms vertices using bone matrices on CPU
   */
  // @ts-ignore - unused for now, will be used in future animation integration
  private applyCPUSkinning(skinningData?: any) {
    // If no specific skinning data provided, apply to all tracked meshes
    if (!skinningData) {
      for (const mesh of this.skinnedMeshes) {
        if (mesh.userData.cpuSkinningData) {
          this.applyCPUSkinning(mesh.userData.cpuSkinningData);
        }
      }
      return;
    }

    if (!skinningData || !this.skeleton) return;

    const { geometry, vertexWeights, basePositions, baseNormals } = skinningData;
    const posAttribute = geometry.getAttribute('position');
    const normalAttribute = geometry.getAttribute('normal');

    // Get bone world matrices and inverse bind matrices
    const boneMatrices = this.skeleton.animWorld || this.skeleton.bones.map((bone: THREE.Bone) => bone.matrixWorld);
    // @ts-ignore - unused for now, will be used in future CPU skinning optimization
    const boneInverses = this.skeleton.threeSkeleton.boneInverses;

    // Transform each vertex
    for (let i = 0; i < vertexWeights.length; i++) {
      const weights = vertexWeights[i];
      if (!weights || weights.length === 0) {
        // No weights - keep base position
        posAttribute.setXYZ(i, basePositions[i * 3 + 0], basePositions[i * 3 + 1], basePositions[i * 3 + 2]);
        normalAttribute.setXYZ(i, baseNormals[i * 3 + 0], baseNormals[i * 3 + 1], baseNormals[i * 3 + 2]);
        continue;
      }

      // If we have bone-local positions from weight entries, use Gothic's direct method
      if (weights[0].position) {
        const resultPos = new THREE.Vector3(0, 0, 0);
        const resultNormal = new THREE.Vector3(0, 0, 0);

        for (const { boneIndex, weight, position, normal } of weights) {
          if (boneIndex >= boneMatrices.length) continue;

          const vertPosOS = new THREE.Vector3(position.x, position.y, position.z);
          const transformedPos = vertPosOS.applyMatrix4(boneMatrices[boneIndex]);
          resultPos.addScaledVector(transformedPos, weight);

          if (normal) {
            const vertNormalOS = new THREE.Vector3(normal.x, normal.y, normal.z);
            const mat3 = new THREE.Matrix3().setFromMatrix4(boneMatrices[boneIndex]);
            const transformedNormal = vertNormalOS.applyMatrix3(mat3);
            resultNormal.addScaledVector(transformedNormal, weight);
          }
        }

        posAttribute.setXYZ(i, resultPos.x, resultPos.y, resultPos.z);
        if (resultNormal.lengthSq() > 0) {
          normalAttribute.setXYZ(i, resultNormal.x, resultNormal.y, resultNormal.z);
        }
      }
    }

    // Mark attributes as needing update
    posAttribute.needsUpdate = true;
    normalAttribute.needsUpdate = true;
  }

  // @ts-ignore - unused for now, will be used in future UI integration
  private updateStatus(message: string, type: string = 'loading') {
    console.log(message);
    // TODO: UI adaptation later
  }

  // @ts-ignore - unused for now, will be used in future UI integration
  private populateHeadsList() {
    // TODO: UI adaptation later
  }

  // @ts-ignore - unused for now, will be used in future animation UI integration
  private addToSequence(animationName: string, mdsAnim: any) {
    this.animationSequence.push({ name: animationName, mdsAnim });
    // TODO: UI update later
    console.log(`➕ Added to sequence: ${animationName} (total: ${this.animationSequence.length})`);
  }

  private setDefaultRunSequence(mds: any, extraAnimations: any[] = []) {
    if (!mds) return;

    const descriptors: any[] = [];

    for (const name of this.DEFAULT_RUN_SEQUENCE) {
      let desc = null;

      // Search base animations
      const baseCount = mds.getAnimationCount ? mds.getAnimationCount() : 0;
      for (let i = 0; i < baseCount; i++) {
        if (mds.getAnimationName(i) === name) {
          desc = {
            name,
            flags: mds.getAnimationFlags(i),
            next: mds.getAnimationNext(i)
          };
          break;
        }
      }

      // Search overlay / extra animations
      if (!desc) {
        for (const extra of extraAnimations) {
          if (extra.name === name) {
            desc = {
              name,
              flags: extra.flags,
              next: extra.next
            };
            break;
          }
        }
      }

      if (!desc) {
        console.log(`ℹ️ Default run sequence missing '${name}' in current MDS/overlay; skipping auto-sequence`);
        return;
      }

      descriptors.push({ name, mdsAnim: desc });
    }

    this.animationSequence = descriptors;
    // TODO: UI update later
    console.log('🎬 Default sequence set: t_Run_2_RunL → s_RunL → t_RunL_2_Run');
  }

  // @ts-ignore - unused for now, will be used in future animation UI integration
  private clearSequence() {
    this.animationSequence = [];
    this.isPlayingSequence = false;
    // TODO: UI update later
    console.log('🗑️ Sequence cleared');
  }

  // TODO: UI update later
  // @ts-ignore - unused for now, will be used in future animation UI integration
  private updateSequenceUI() {
    // Implementation will be added when UI is integrated
  }

  // @ts-ignore - unused for now, will be used in future animation UI integration
  private async playSequence() {
    if (this.animationSequence.length === 0) {
      console.log('⚠️ No animations in sequence');
      return;
    }

    if (this.isPlayingSequence) {
      console.log('⚠️ Sequence already playing');
      return;
    }

    this.isPlayingSequence = true;
    console.log(`▶️ Starting sequence playback (${this.animationSequence.length} animations)`);

    for (let i = 0; i < this.animationSequence.length; i++) {
      if (!this.isPlayingSequence) {
        console.log('⏹️ Sequence playback stopped');
        break;
      }

      const item = this.animationSequence[i];
      console.log(`▶️ [${i + 1}/${this.animationSequence.length}] Playing: ${item.name}`);

                // Load the animation and play it via PoseEvaluator
                const seq = await this.loadAnimation(item.name, item.mdsAnim, this.currentMdsBaseName.toUpperCase() || '');
      if (seq && seq._man && this.poseEvaluator) {
        this.isAnimLooping = false;
        this.currentAnimTimeMs = 0;
        this.poseEvaluator.setAnimationFromWrapper(seq._man);
        this.isAnimPlaying = true;

        const duration = this.poseEvaluator.getTotalTimeMs();
        await new Promise(resolve => setTimeout(resolve, duration));
      } else {
        console.warn(`⚠️ Failed to load animation: ${item.name}`);
      }
    }

    this.isPlayingSequence = false;
    console.log('✅ Sequence playback completed');
  }

  async loadMdsFile(mdsFileName: string = this.DEFAULT_MDS, overlayFileName: string | null = null) {
    try {
      this.updateStatus('📖 Loading MDS file...', 'loading');
      // Reset sequence state on new load
      this.animationSequence = [];
      this.isPlayingSequence = false;

      // Store the base name (without path/ext) for later use with animations
      const mdsFileOnly = mdsFileName.split('/').pop() || mdsFileName;
      this.currentMdsBaseName = mdsFileOnly.replace(/\.(MDS|MSB)$/i, '');
      this.overlayAnimations = [];
      this.overlayDisabled = [];

      // Load MDS file from public/game-assets/ANIMS/
      const response = await fetch(`/ANIMS/${mdsFileName}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch MDS file: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Create ModelScript and load
      const mds = this.ZenKit!.createModelScript();
      const loadResult = mds.loadFromArray(uint8Array);

      if (!loadResult.success) {
        throw new Error(loadResult.errorMessage || mds.getLastError() || 'Unknown loading error');
      }

      this.updateStatus('✅ MDS file loaded successfully!', 'success');

      // If overlay requested, load it for animations only
      if (overlayFileName) {
        try {
          const ovFileOnly = overlayFileName.split('/').pop() || overlayFileName;
          const ovBaseName = ovFileOnly.replace(/\.(MDS|MSB)$/i, '').toUpperCase();
          const ovResp = await fetch(`/ANIMS/${overlayFileName}`);
          if (ovResp.ok) {
            const ovBuf = await ovResp.arrayBuffer();
            const ovU8 = new Uint8Array(ovBuf);
            const ovMds = this.ZenKit!.createModelScript();
            const ovRes = ovMds.loadFromArray(ovU8);
            if (ovRes.success) {
              const ovAnimCount = ovMds.getAnimationCount();
              for (let i = 0; i < ovAnimCount; i++) {
                this.overlayAnimations.push({
                  name: ovMds.getAnimationName(i),
                  layer: ovMds.getAnimationLayer(i),
                  next: ovMds.getAnimationNext(i),
                  blendIn: ovMds.getAnimationBlendIn(i),
                  blendOut: ovMds.getAnimationBlendOut(i),
                  flags: ovMds.getAnimationFlags(i),
                  model: ovMds.getAnimationModel(i),
                  firstFrame: ovMds.getAnimationFirstFrame(i),
                  lastFrame: ovMds.getAnimationLastFrame(i),
                  fps: ovMds.getAnimationFps(i),
                  speed: ovMds.getAnimationSpeed(i),
                  sourceBase: ovBaseName
                });
              }
              const ovDisabledCount = ovMds.getDisabledAnimationCount();
              for (let i = 0; i < ovDisabledCount; i++) {
                this.overlayDisabled.push(ovMds.getDisabledAnimationName(i));
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to load overlay MDS ${overlayFileName}: ${(e as Error).message}`);
        }
      }

      // Display information (base + overlay animations)
      this.displayMdsInfo(mds, this.overlayAnimations, this.overlayDisabled);

      // Set a default run sequence if all required animations are present
      this.setDefaultRunSequence(mds, this.overlayAnimations);

      // Load and render the skeleton mesh (pass MDS filename for MDH lookup)
      await this.loadAndRenderSkeleton(mds, mdsFileName);

    } catch (error) {
      this.updateStatus(`❌ Failed to load MDS file: ${(error as Error).message}`, 'error');
      console.error('MDS loading error:', error);
    }
  }

  async loadAndRenderSkeleton(mds: any, mdsFileName: string = this.DEFAULT_MDS) {
    try {
      const mdsSkeletonName = mds.getSkeletonName();
      const mdsFileOnly = mdsFileName.split('/').pop() || mdsFileName;

      let skeletonBaseName;

      // If user selected a specific mesh from UI, use it
      if (this.activeMeshName) {
        skeletonBaseName = this.activeMeshName.replace(/\.(ASC|MDM|MDH|MDL)$/i, '').toUpperCase();
        console.log(`🎯 Using user-selected mesh: ${skeletonBaseName}`);
      } else if (mdsSkeletonName) {
        // Use skeleton from MDS file
        skeletonBaseName = mdsSkeletonName.replace(/\.(ASC|MDM|MDH|MDL)$/i, '').toUpperCase();
      } else {
        // Fallback to default human body
        skeletonBaseName = 'HUM_BODY_NAKED0';
        console.log('⚠️ No skeleton defined in MDS, using default: HUM_BODY_NAKED0');
      }

      const mdsBaseName = mdsFileOnly.replace(/\.(MDS|MSB)$/i, '').toUpperCase();
      const skeletonName = `${skeletonBaseName}.MDM`;
      this.currentSkeletonBaseName = skeletonBaseName;

      this.updateStatus(`📦 Loading skeleton mesh: ${skeletonName}...`, 'loading');

      // Load MDH + MDM directly (MDL not available in provided assets)
      let model = null;
      const mdhPath = `/ANIMS/_COMPILED/${mdsBaseName}.MDH`;
      const mdmPath = `/ANIMS/_COMPILED/${skeletonBaseName}.MDM`;

      this.updateStatus(`📦 Loading MDH (${mdsBaseName}) + MDM (${skeletonBaseName})...`, 'loading');

      try {
        // Load hierarchy (.MDH)
        const mdhResponse = await fetch(mdhPath);
        if (!mdhResponse.ok) {
          throw new Error(`MDH not found: ${mdhPath}`);
        }

        const mdhArrayBuffer = await mdhResponse.arrayBuffer();
        const mdhUint8Array = new Uint8Array(mdhArrayBuffer);

        const hierarchyLoader = this.ZenKit!.createModelHierarchyLoader();
        const mdhLoadResult = hierarchyLoader.loadFromArray(mdhUint8Array);

        if (!mdhLoadResult || !mdhLoadResult.success) {
          throw new Error(`Failed to load MDH: ${hierarchyLoader.getLastError()}`);
        }

        // Load mesh (.MDM)
        const mdmResponse = await fetch(mdmPath);
        if (!mdmResponse.ok) {
          throw new Error(`MDM not found: ${mdmPath}`);
        }

        const mdmArrayBuffer = await mdmResponse.arrayBuffer();
        const mdmUint8Array = new Uint8Array(mdmArrayBuffer);

        const meshLoader = this.ZenKit!.createModelMeshLoader();
        const mdmLoadResult = meshLoader.loadFromArray(mdmUint8Array);

        if (!mdmLoadResult || !mdmLoadResult.success) {
          throw new Error(`Failed to load MDM: ${meshLoader.getLastError()}`);
        }

        // Combine hierarchy and mesh into a Model
        model = this.ZenKit!.createModel();
        model.setHierarchy(hierarchyLoader.getHierarchy());
        model.setMesh(meshLoader.getMesh());

      } catch (error) {
        this.updateStatus(`⚠️ Could not load MDH+MDM: ${(error as Error).message}`, 'loading');
        return;
      }

      if (!model) {
        this.updateStatus('⚠️ Could not load model mesh', 'loading');
        return;
      }

      this.updateStatus('🎨 Rendering model...', 'loading');

      // Render the model
      await this.renderModel(model);

      this.updateStatus('✅ Model rendered successfully!', 'success');

    } catch (error) {
      this.updateStatus(`❌ Failed to load skeleton: ${(error as Error).message}`, 'error');
      console.error('Skeleton loading error:', error);
    }
  }

  // Continue with the rest of the methods from mds-viewer.html...
  // This is a large file, so I'll continue in subsequent calls

  async renderModel(model: any) {
    try {
      // Remove existing mesh
      if (this.modelMesh) {
        this.scene!.remove(this.modelMesh);
                if (this.modelMesh.children) {
                  this.modelMesh.children.forEach((child: any) => {
                    if (child.geometry) child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                      (child.material as THREE.Material[]).forEach((m: THREE.Material) => m.dispose());
                    } else if (child.material) {
                      (child.material as THREE.Material).dispose();
                    }
                  });
                }
      }

      // Clear skinned meshes array
      this.skinnedMeshes = [];
      if (this.skeletonHelper) {
        this.scene!.remove(this.skeletonHelper);
        if (this.skeletonHelper.material) {
          if (Array.isArray(this.skeletonHelper.material)) {
            this.skeletonHelper.material.forEach((mat: THREE.Material) => mat.dispose());
          } else {
            (this.skeletonHelper.material as THREE.Material).dispose();
          }
        }
        this.skeletonHelper = null;
      }

      // Get hierarchy to build skeleton
      const hierarchy = model.getHierarchy();

      // Build custom Skeleton class (mimics OpenGothic)
      this.skeleton = new (this.Skeleton as any)(hierarchy);

                // Initialize PoseEvaluator (WASM)
                this.poseEvaluator = this.ZenKit!.createPoseEvaluator();

      // Initialize Animation
      if (!this.animation) {
        this.animation = new (this.Animation as any)();
      }

      // Check for attachments first
      const attachmentNames = model.getAttachmentNames();
      const attachmentCount = attachmentNames.size();

      console.log(`📦 Model attachments: ${attachmentCount}`);
      for (let i = 0; i < attachmentCount; i++) {
        console.log(`   - ${attachmentNames.get(i)}`);
      }

      if (attachmentCount === 0) {
        // Try soft-skin meshes
        const softSkinMeshes = model.getSoftSkinMeshes();
        const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;

        console.log(`📦 Soft-skin meshes: ${softSkinCount}`);

        if (softSkinCount === 0) {
          this.updateStatus('⚠️ Model has no renderable meshes', 'loading');
          return;
        }

        // Render soft-skin meshes
        const modelGroup = new THREE.Group();

        // List hierarchy nodes to find head bone
        const nodeCount = hierarchy.nodes.size ? hierarchy.nodes.size() : hierarchy.nodes.length;
        console.log(`📋 Hierarchy nodes: ${nodeCount}`);
        this.headNodeIndex = -1; // Use global variable
        for (let j = 0; j < nodeCount; j++) {
          const node = hierarchy.nodes.get ? hierarchy.nodes.get(j) : hierarchy.nodes[j];
          const nodeName = node.name || '';
          if (nodeName.toUpperCase().includes('HEAD') || nodeName === 'BIP01 HEAD') {
            this.headNodeIndex = j;
            console.log(`   ✅ Found head bone: ${nodeName} (index ${j})`);
          }
          if (j < 10) { // Show first 10 nodes
            console.log(`   [${j}] ${nodeName} (parent: ${node.parentIndex})`);
          }
        }

        let renderedCount = 0;
        for (let i = 0; i < softSkinCount; i++) {
          const softSkinMesh = softSkinMeshes.get(i);
          if (!softSkinMesh) {
            console.warn(`⚠️ Soft-skin mesh ${i} is null`);
            continue;
          }

          // Use CPU skinning with raw SoftSkinMesh data (Gothic's approach!)
          const { geometry, material, hasSkinning, skinningData } = await this.buildSoftSkinGeometryCPU(softSkinMesh, this.skeleton);

          let meshObj;
          if (hasSkinning && this.skeleton) {
            // Use regular Mesh for CPU skinning (not SkinnedMesh)
            meshObj = new THREE.Mesh(geometry, material);

            // Disable frustum culling for animated characters
            meshObj.frustumCulled = false;

            // Store CPU skinning data on the mesh
            if (skinningData) {
              meshObj.userData.cpuSkinningData = skinningData;
              this.skinnedMeshes.push(meshObj);
              console.log(`   ✅ Stored CPU skinning data for soft-skin mesh ${i}`);
            }

            // Add root bones to the scene (for skeleton helper visualization)
            for (const rootIdx of this.skeleton.rootNodes) {
              if (modelGroup.children.indexOf(this.skeleton.bones[rootIdx]) === -1) {
                modelGroup.add(this.skeleton.bones[rootIdx]);
              }
            }

            this.characterMesh = meshObj; // Store reference
            console.log(`   ✅ Created CPU-skinned mesh for soft-skin mesh ${i} (Gothic engine approach)`);
          } else {
            meshObj = new THREE.Mesh(geometry, material);
            console.log(`   ℹ️ Created static mesh for soft-skin mesh ${i} (skinning: ${hasSkinning})`);
          }

          modelGroup.add(meshObj);
          renderedCount++;
        }

        console.log(`✅ Rendered ${renderedCount} soft-skin meshes`);

        // Try to load head mesh if head bone exists
        if (this.headNodeIndex >= 0) {
          await this.tryLoadHeadMesh(modelGroup, hierarchy, this.headNodeIndex);
        }

        if (modelGroup.children.length === 0) {
          this.updateStatus('⚠️ No meshes rendered', 'loading');
          return;
        }

        this.modelMesh = modelGroup;
      } else {
        // Render attachments
        const modelGroup = new THREE.Group();

        function getAccumulatedTransform(nodeIndex: number) {
          let currentIndex = nodeIndex;
          let accumulatedMatrix = new THREE.Matrix4();

          while (currentIndex >= 0) {
            const node = hierarchy.nodes.get ? hierarchy.nodes.get(currentIndex) : hierarchy.nodes[currentIndex];
            const nodeTransform = node.getTransform();
            const nodeMatrix = new THREE.Matrix4();

            const matrixData = nodeTransform.toArray();
            for (let i = 0; i < 16; i++) {
              nodeMatrix.elements[i] = matrixData[i];
            }

            const tempMatrix = new THREE.Matrix4();
            tempMatrix.multiplyMatrices(nodeMatrix, accumulatedMatrix);
            accumulatedMatrix = tempMatrix;

            currentIndex = node.parentIndex;
          }

          return accumulatedMatrix;
        }

        for (let i = 0; i < attachmentNames.size(); i++) {
          const attachmentName = attachmentNames.get(i);
          const attachment = model.getAttachment(attachmentName);
          if (!attachment) {
            console.warn(`⚠️ Attachment ${attachmentName} not found in model`);
            continue;
          }

          let hierarchyNodeIndex = -1;
          const nodeCount = hierarchy.nodes.size ? hierarchy.nodes.size() : hierarchy.nodes.length;
          for (let j = 0; j < nodeCount; j++) {
            const node = hierarchy.nodes.get ? hierarchy.nodes.get(j) : hierarchy.nodes[j];
            if (node && node.name === attachmentName) {
              hierarchyNodeIndex = j;
              break;
            }
          }

          const processed = model.convertAttachmentToProcessedMesh(attachment);
          if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
            console.warn(`⚠️ Attachment ${attachmentName} has no geometry`);
            continue;
          }

          const { geometry, material, hasSkinning: attachmentHasSkinning, skinningData: attachmentSkinningData } = await this.buildAttachmentGeometry(processed, this.skeleton);
          const attachmentMesh = new THREE.Mesh(geometry, material);

          // Store CPU skinning data on attachment mesh if it has skinning
          if (attachmentHasSkinning && this.skeleton && attachmentSkinningData) {
            attachmentMesh.userData.cpuSkinningData = attachmentSkinningData;
            this.skinnedMeshes.push(attachmentMesh);
            console.log(`   ✅ Stored CPU skinning data for attachment ${attachmentName}`);
          }

          if (hierarchyNodeIndex >= 0) {
            const accumulatedMatrix = getAccumulatedTransform(hierarchyNodeIndex);
            attachmentMesh.applyMatrix4(accumulatedMatrix);
            console.log(`   ✅ Applied transform from hierarchy node ${hierarchyNodeIndex}`);
          } else {
            console.warn(`   ⚠️ No hierarchy node found for ${attachmentName}, rendering at origin`);
          }

          modelGroup.add(attachmentMesh);
        }

        if (modelGroup.children.length === 0) {
          this.updateStatus('⚠️ No attachments rendered', 'loading');
          return;
        }

        console.log(`✅ Rendered ${modelGroup.children.length} attachments`);
        this.modelMesh = modelGroup;
      }

      // Center the model
      const box = new THREE.Box3().setFromObject(this.modelMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      console.log(`📐 Model bounds: center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}), size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);

      this.modelMesh.position.sub(center);

      this.scene!.add(this.modelMesh);
      if (this.skeleton) {
        this.skeletonHelper = new THREE.SkeletonHelper(this.modelMesh);
        (this.skeletonHelper.material as THREE.LineBasicMaterial).color = new THREE.Color(0x00ff00);
        if ('linewidth' in this.skeletonHelper.material) {
          (this.skeletonHelper.material as any).linewidth = 2;
        }

        // Disable frustum culling for skeleton helper (same reason as SkinnedMesh)
        this.skeletonHelper.frustumCulled = false;

        this.scene!.add(this.skeletonHelper);
      }

      console.log(`📷 Camera positioned at: (${this.camera!.position.x.toFixed(2)}, ${this.camera!.position.y.toFixed(2)}, ${this.camera!.position.z.toFixed(2)})`);

      this.renderer!.render(this.scene!, this.camera!);

    } catch (error) {
      this.updateStatus(`❌ Failed to render model: ${(error as Error).message}`, 'error');
      console.error('Model rendering error:', error);
    }
  }

  // Placeholder for other methods
  async loadModelCached(modelPath: string) {
    // Check cache first
    if (this.modelCache.has(modelPath)) {
      return this.modelCache.get(modelPath);
    }

    try {
      const response = await fetch(modelPath);

      // Check if file doesn't exist
      const contentType = response.headers.get('content-type') || '';
      const is404 = !response.ok || contentType.includes('text/html');

      if (is404) {
        return null;
      }

      // Load .MDL file
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const model = this.ZenKit!.createModel();
      const loadResult = model.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        return null;
      }

      if (!model.isLoaded) {
        return null;
      }

      // Cache and return
      this.modelCache.set(modelPath, model);
      return model;
    } catch (error) {
      return null;
    }
  }

  /**
   * Build geometry for CPU skinning directly from SoftSkinMesh raw data
   * Accesses vertex positions in bone-local space (like Gothic's vertPosOS)
   */
  async buildSoftSkinGeometryCPU(softSkinMesh: any, skeleton: any) {
    // Access the MultiResolutionMesh inside the SoftSkinMesh
    const mrMesh = softSkinMesh.mesh;
    // @ts-ignore - unused for now, will be used in future advanced CPU skinning
    const positions_raw = mrMesh.positions; // Raw positions in bone-local space!
    const normals_raw = mrMesh.normals;
    const subMeshes = mrMesh.subMeshes;
    const weights = softSkinMesh.weights; // Per-vertex weight data

    // Precompute bind-pose matrices (inverse of boneInverses)
    const bindMatrices = skeleton.threeSkeleton.boneInverses.map((inv: THREE.Matrix4) => {
      const m = new THREE.Matrix4();
      m.copy(inv).invert();
      return m;
    });

    // Build expanded vertex arrays (non-indexed for simplicity)
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const vertexWeights: any[] = [];
    const materials: any[] = [];

    let currentMatIndex = 0;
    const triGroups: any[] = []; // {start, count, matIndex}
    let triCount = 0;

    console.log(`✅ Building CPU-skinned geometry from ${subMeshes.size()} submeshes`);

    for (let subMeshIdx = 0; subMeshIdx < subMeshes.size(); subMeshIdx++) {
      const subMesh = subMeshes.get(subMeshIdx);
      const groupStart = triCount;

      // Add material
      materials.push({
        texture: subMesh.mat.texture || ''
      });

      const triangles = subMesh.triangles;
      const wedges = subMesh.wedges;

      console.log(`   Submesh ${subMeshIdx}: ${triangles.size()} triangles, ${wedges.size()} wedges`);

      // Process triangles in this submesh
      for (let triIdx = 0; triIdx < triangles.size(); triIdx++) {
        const triangle = triangles.get(triIdx);

        // Each triangle has 3 wedges (indices into wedges array)
        for (let i = 0; i < 3; i++) {
          const wedgeIdx = triangle.getWedge(i);
          const wedge = wedges.get(wedgeIdx);
          const vertIdx = wedge.index; // Index into positions_raw/normals_raw

          const vertWeights = weights.get(vertIdx);
          const weightArray: any[] = [];

          // Compute bind-pose blended position/normal using weight-local positions and bind matrices
          const bindPos = new THREE.Vector3(0, 0, 0);
          const bindNorm = new THREE.Vector3(0, 0, 0);
          const baseNormalOS = normals_raw.get(vertIdx);

          for (let j = 0; j < vertWeights.size(); j++) {
            const w = vertWeights.get(j);
            if (w.weight > 0.0001) {
              const boneIndex = w.nodeIndex;
              const bindMatrix = bindMatrices[boneIndex] || new THREE.Matrix4();

              const posOS = new THREE.Vector3(w.position.x, w.position.y, w.position.z);
              const posBind = posOS.clone().applyMatrix4(bindMatrix);
              bindPos.addScaledVector(posBind, w.weight);

              const mat3 = new THREE.Matrix3().setFromMatrix4(bindMatrix);
              const nBind = new THREE.Vector3(baseNormalOS.x, baseNormalOS.y, baseNormalOS.z).applyMatrix3(mat3);
              bindNorm.addScaledVector(nBind, w.weight);

              weightArray.push({
                boneIndex: boneIndex,
                weight: w.weight,
                position: { x: w.position.x, y: w.position.y, z: w.position.z },
                normal: { x: baseNormalOS.x, y: baseNormalOS.y, z: baseNormalOS.z }
              });
            }
          }

          positions.push(bindPos.x, bindPos.y, bindPos.z);
          normals.push(bindNorm.x, bindNorm.y, bindNorm.z);

          // Get UV from wedge
          uvs.push(wedge.texture.x, wedge.texture.y);

          vertexWeights.push(weightArray);
        }

        triCount++;
      }

      triGroups.push({
        start: groupStart * 3,
        count: (triCount - groupStart) * 3,
        matIndex: currentMatIndex
      });
      currentMatIndex++;
    }

    // Create Three.js geometry
    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(positions), 3);
    const normalAttr = new THREE.BufferAttribute(new Float32Array(normals), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    normalAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('normal', normalAttr);
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));

    // Add material groups
    for (const group of triGroups) {
      geometry.addGroup(group.start, group.count, group.matIndex);
    }

    // Build materials
    const materialArray: any[] = [];
    for (let mi = 0; mi < materials.length; mi++) {
      const matData = materials[mi];
      const textureName = matData.texture || '';

      const phongMaterial = new THREE.MeshPhongMaterial({
        color: 0xFFFFFF,
        side: THREE.DoubleSide,
        transparent: false,
        alphaTest: 0.5
      });

      // Load texture if available
      if (textureName && textureName.length) {
        const url = this.tgaNameToCompiledUrl(textureName);
        if (url) {
          const tex = await this.loadTextureCached(url);
          if (tex) {
            phongMaterial.map = tex;
            phongMaterial.needsUpdate = true;
          }
        }
      }

      materialArray.push(phongMaterial);
    }

    const material = materialArray.length > 0 ? materialArray : new THREE.MeshPhongMaterial({
      color: 0xCCCCCC,
      side: THREE.DoubleSide
    });

    // Create CPU skinning data object (return it, don't store globally)
    const skinningData = {
      geometry: geometry,
      vertexWeights: vertexWeights,
      basePositions: new Float32Array(positions),
      baseNormals: new Float32Array(normals)
    };

    return { geometry, material, hasSkinning: true, skinningData };
  }

  // Build geometry (and optional CPU skinning data) from processed attachment mesh
  async buildAttachmentGeometry(processed: any, skeleton: any) {
    const idxCount = processed.indices.size();
    // @ts-ignore - unused for now, will be used in future material group optimization
    const matCount = processed.materials.size();

    // Build Three.js geometry
    const positions = new Float32Array(idxCount * 3);
    const normals = new Float32Array(idxCount * 3);
    const uvs = new Float32Array(idxCount * 2);

    // For CPU skinning: store base positions, normals, and weight data
    const hasSkinning = processed.boneWeights && processed.boneWeights.size() > 0;

    // IMPORTANT: For CPU skinning, we need UNIQUE vertices, not indexed!
    // Gothic processes each vertex independently with its bone weights
    const numUniqueVerts = idxCount; // After index expansion
    const basePositions = new Float32Array(numUniqueVerts * 3);
    const baseNormals = new Float32Array(numUniqueVerts * 3);
    const vertexWeights: any[] = []; // Array of {boneIndex, weight} arrays per UNIQUE vertex

    for (let i = 0; i < idxCount; i++) {
      const vertIdx = processed.indices.get(i);
      const vertBase = vertIdx * 8;

      // Store base positions and normals (these are in BIND POSE, not animated)
      basePositions[i * 3 + 0] = processed.vertices.get(vertBase + 0);
      basePositions[i * 3 + 1] = processed.vertices.get(vertBase + 1);
      basePositions[i * 3 + 2] = processed.vertices.get(vertBase + 2);

      baseNormals[i * 3 + 0] = processed.vertices.get(vertBase + 3);
      baseNormals[i * 3 + 1] = processed.vertices.get(vertBase + 4);
      baseNormals[i * 3 + 2] = processed.vertices.get(vertBase + 5);

      // Copy to working arrays (will be updated by CPU skinning)
      positions[i * 3 + 0] = basePositions[i * 3 + 0];
      positions[i * 3 + 1] = basePositions[i * 3 + 1];
      positions[i * 3 + 2] = basePositions[i * 3 + 2];

      normals[i * 3 + 0] = baseNormals[i * 3 + 0];
      normals[i * 3 + 1] = baseNormals[i * 3 + 1];
      normals[i * 3 + 2] = baseNormals[i * 3 + 2];

      uvs[i * 2 + 0] = processed.vertices.get(vertBase + 6);
      uvs[i * 2 + 1] = processed.vertices.get(vertBase + 7);

      if (hasSkinning) {
        const skinBase = vertIdx * 4;
        const weights: any[] = [];

        // Collect bone weights (Gothic supports up to 4 influences)
        for (let j = 0; j < 4; j++) {
          const boneIdx = processed.boneIndices.get(skinBase + j);
          const weight = processed.boneWeights.get(skinBase + j);

          if (weight > 0.0001) { // Skip negligible weights
            weights.push({ boneIndex: boneIdx, weight: weight });
          }
        }

        vertexWeights[i] = weights;
      }
    }

    const geometry = new THREE.BufferGeometry();
    // Mark buffers as dynamic since we'll update them every frame
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const normalAttr = new THREE.BufferAttribute(normals, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    normalAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('normal', normalAttr);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // NO skinning attributes for CPU skinning - we handle it manually

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

    // Build material(s) - use standard Three.js materials
    let material;
    if (hasSkinning && skeleton) {
      // Create material array for each material group
      const materialArray: any[] = [];
      const matCountProcessed = processed.materials.size();

      for (let mi = 0; mi < matCountProcessed; mi++) {
        const matData = processed.materials.get(mi);
        const textureName = matData.texture || '';

        const phongMaterial = new THREE.MeshPhongMaterial({
          color: 0xFFFFFF,
          side: THREE.DoubleSide,
          transparent: false,
          alphaTest: 0.5
        });

        // Load texture if available
        if (textureName && textureName.length) {
          const url = this.tgaNameToCompiledUrl(textureName);
          if (url) {
            console.log(`📦 Loading texture for material ${mi}: ${textureName} -> ${url}`);
            const tex = await this.loadTextureCached(url);
            if (tex) {
              phongMaterial.map = tex;
              phongMaterial.needsUpdate = true;
              console.log(`✅ Loaded texture for material ${mi}: ${textureName} (${tex.width}x${tex.height})`);
            } else {
              console.warn(`⚠️ Failed to load texture: ${textureName} from ${url}`);
            }
          } else {
            console.warn(`⚠️ Failed to generate URL for texture: ${textureName}`);
          }
        } else {
          console.log(`ℹ️ Material ${mi} has no texture name`);
        }

        materialArray.push(phongMaterial);
      }

      material = materialArray.length > 0 ? materialArray : new THREE.MeshPhongMaterial({
        color: 0xCCCCCC,
        side: THREE.DoubleSide
      });

    } else {
      // Static mesh - load texture
      if (processed.materials.size() > 0) {
        material = await this.getMaterialCached(processed.materials.get(0));
      } else {
        material = new THREE.MeshPhongMaterial({
          color: 0xCCCCCC,
          side: THREE.DoubleSide
        });
      }
    }

    // Create CPU skinning data object (return it, don't store globally)
    let skinningData = null;
    if (hasSkinning && skeleton) {
      skinningData = {
        geometry: geometry,
        vertexWeights: vertexWeights,
        basePositions: basePositions,
        baseNormals: baseNormals
      };
    }

    return { geometry, material, hasSkinning, skinningData };
  }

  async loadAnimation(animationName: string, mdsAnimation: any = null, manBaseName: string | null = null) {
    try {
      const baseName = (manBaseName || this.currentMdsBaseName || '').toUpperCase();
      const cacheKey = `${baseName}:${animationName}`;
      if (this.animationCache.has(cacheKey)) {
        return this.animationCache.get(cacheKey);
      }

      const manFileName = `${baseName}-${animationName}.MAN`.toUpperCase();
      const manPath = `/ANIMS/_COMPILED/${manFileName}`;

      console.log(`🎬 Loading animation: ${manPath}`);
      const response = await fetch(manPath);
      if (!response.ok) {
        console.warn(`Animation file ${manPath} not found`);
        return null;
      }

      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);

      const man = this.ZenKit!.createModelAnimation();
      if (!man) {
        throw new Error('Failed to create ModelAnimation instance');
      }
      const loadResult = man.loadFromArray(data);

      if (!loadResult.success) {
        throw new Error(loadResult.errorMessage || man.getLastError() || 'Unknown loading error');
      }

      // Verify we can access node indices via getNodeIndex method
      const nodeCount = man.getNodeCount ? man.getNodeCount() : 0;
      if (nodeCount === 0) {
        throw new Error('Animation has no nodes - invalid animation data');
      }

      const seq = new (this.AnimationSequence as any)(man, mdsAnimation);
      // Attach the underlying ModelAnimation wrapper for PoseEvaluator
      seq._man = man;
      if (!this.animation) {
        this.animation = new (this.Animation as any)();
      }
      this.animation.addSequence(animationName, seq);
      this.animationCache.set(cacheKey, seq);

      console.log(`✅ Loaded animation: ${animationName} (${seq.numFrames} frames, ${seq.nodeIndex.length} bones)`);
      return seq;
    } catch (e) {
      console.error(`Failed to load animation ${animationName}:`, e);
      return null;
    }
  }

  async playAnimation(animationName: string, mdsAnimation: any = null) {
    if (!this.poseEvaluator) {
      console.warn('⚠️ No pose evaluator initialized');
      return;
    }

    const baseName = (this.currentMdsBaseName || '').toUpperCase();
            const seq = await this.loadAnimation(animationName, mdsAnimation, baseName || '');
    if (!seq || !seq._man) {
      console.warn(`⚠️ Animation ${animationName} could not be loaded for playback`);
      return;
    }

    // One-shot play
    this.isAnimLooping = false;
    this.currentAnimTimeMs = 0;
    this.poseEvaluator.setAnimationFromWrapper(seq._man);
    this.isAnimPlaying = true;

    // Update UI (TODO: implement when UI is ready)
  }

  async getMaterialCached(materialData: any) {
    const textureName = materialData.texture || '';

    if (this.materialCache.has(textureName)) {
      return this.materialCache.get(textureName);
    }

    const material = new THREE.MeshPhongMaterial({
      color: 0xFFFFFF,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.5
    });

    if (textureName && textureName.length) {
      const url = this.tgaNameToCompiledUrl(textureName);
      if (url) {
        const tex = await this.loadTextureCached(url);
        if (tex) {
          material.map = tex;
          material.needsUpdate = true;
        }
      }
    }

    this.materialCache.set(textureName, material);
    return material;
  }

  async loadTextureCached(texturePath: string) {
    if (this.textureCache.has(texturePath)) {
      return this.textureCache.get(texturePath);
    }

    try {
      let tex = await this.loadCompiledTexAsDataTexture(texturePath);

      // If texture not found, try fallback to C0 variant (most armors reference Cx that don't exist)
      if (!tex && texturePath.includes('_C') && !texturePath.includes('_C0-C.TEX')) {
        const fallbackPath = texturePath.replace(/_C\d+(-C\.TEX)$/, '_C0$1');
        console.log(`   ⚠️ Texture not found, trying fallback: ${fallbackPath}`);
        tex = await this.loadCompiledTexAsDataTexture(fallbackPath);
        if (tex) {
          this.textureCache.set(texturePath, tex); // Cache under original name too
        }
      }

      if (tex) {
        this.textureCache.set(texturePath, tex);
      }
      return tex;
    } catch (error) {
      return null;
    }
  }

  async loadCompiledTexAsDataTexture(url: string) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const arr = new Uint8Array(buf);
    const zkTex = new this.ZenKit!.Texture();
    const ok = zkTex.loadFromArray(arr);
    if (!ok || !ok.success) return null;
    const w = zkTex.width;
    const h = zkTex.height;
    const rgba = zkTex.asRgba8(0);
    if (!rgba) return null;
    const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer!.capabilities.getMaxAnisotropy();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }

  tgaNameToCompiledUrl(name: string) {
    if (!name || typeof name !== 'string') return null;
    let base = name.replace(/\.[^.]*$/, '').toUpperCase();

    // Fix common typos in original Gothic assets
    // NACKED -> NAKED (typo in some armor materials)
    base = base.replace(/NACKED/g, 'NAKED');

    // Textures use the naming convention from the original assets
    // Each mesh/head model references its texture in the material

    return `/TEXTURES/_COMPILED/${base}-C.TEX`;
  }

  // @ts-ignore - hierarchy parameter unused for now, will be used in future bone attachment logic
  async tryLoadHeadMesh(modelGroup: THREE.Group, hierarchy: any, headNodeIndex: number) {
    // If we ever discover a missing asset, disable further attempts
    const markUnavailable = () => { this.headMeshesAvailable = false; };

    try {
      if (this.headMeshesAvailable === false) {
        console.log('ℹ️ Head MMB assets not available; skipping head load');
        return;
      }

      // Use user-selected head if available, otherwise try common defaults
      let headMeshNames;
      if (this.activeHeadName) {
        headMeshNames = [this.activeHeadName];
        console.log(`🎭 Loading user-selected head: ${this.activeHeadName}`);
      } else {
        // Try first few male heads as defaults (most common)
        headMeshNames = this.MALE_HEADS.slice(0, 3);
        console.log('🔄 Auto-loading default head');
      }

      for (const headName of headMeshNames) {
        const headMmbPath = `/ANIMS/_COMPILED/${headName}.MMB`;

        try {
          const response = await fetch(headMmbPath);
          if (!response.ok) {
            markUnavailable();
            continue;
          }

          this.updateStatus(`📦 Loading head mesh: ${headName}...`, 'loading');

          const arrayBuffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          const morphMesh = this.ZenKit!.createMorphMesh();
          const loadResult = morphMesh.loadFromArray(uint8Array);

          if (!loadResult || !loadResult.success) {
            continue;
          }

          const processed = morphMesh.convertToProcessedMesh();
          if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
            continue;
          }

          const { geometry, material } = await this.buildAttachmentGeometry(processed, this.skeleton);
          const headMesh = new THREE.Mesh(geometry, material);

          // Disable frustum culling for head (attached to animated bone)
          headMesh.frustumCulled = false;

          // Attach head mesh directly to the head bone
          if (this.skeleton && this.skeleton.bones && headNodeIndex >= 0 && headNodeIndex < this.skeleton.bones.length) {
            const headBone = this.skeleton.bones[headNodeIndex];
            headBone.add(headMesh);
            console.log(`✅ Attached head mesh to bone: ${headBone.name}`);
          } else {
            console.warn(`⚠️ Could not find head bone to attach mesh`);
            modelGroup.add(headMesh); // Fallback
          }

          this.headMeshesAvailable = true;
          this.updateStatus(`✅ Head mesh loaded: ${headName}`, 'success');
          return; // Successfully loaded head
        } catch (error) {
          // Try next head mesh name
          continue;
        }
      }

      console.log(`⚠️ No head mesh found (tried: ${headMeshNames.join(', ')})`);
      markUnavailable();
    } catch (error) {
      console.warn(`⚠️ Failed to load head mesh: ${(error as Error).message}`);
      markUnavailable();
    }
  }

  displayMdsInfo(mds: any, extraAnimations: any[] = [], extraDisabled: string[] = []) {
    console.log(`✅ Displayed MDS information:`);
    console.log(`   - Skeleton: ${mds.getSkeletonName()}`);
    console.log(`   - Meshes: ${mds.getMeshCount()}`);
    console.log(`   - Disabled animations: ${mds.getDisabledAnimationCount() + extraDisabled.length}`);
    console.log(`   - Animations: ${mds.getAnimationCount() + extraAnimations.length}`);

    // Auto-load first animation if available (async, don't await here)
    if (mds.getAnimationCount() > 0 && this.poseEvaluator && this.animation) {
      const firstAnimName = mds.getAnimationName(0);
      const mdsAnim = {
        name: firstAnimName,
        flags: mds.getAnimationFlags(0),
        next: mds.getAnimationNext(0)
      };
      this.loadAnimation(firstAnimName, mdsAnim, (this.currentMdsBaseName || '').toUpperCase()).then(seq => {
        if (seq) {
          console.log(`Auto-loaded animation: ${firstAnimName}`);
        }
      });
    }
  }
}
