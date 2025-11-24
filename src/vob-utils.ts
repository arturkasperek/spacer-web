// VOB utility functions for path resolution and helpers
import type { Vob } from '@kolarz3/zenkit';

// VOB type name mapping (based on ZenKit VirtualObjectType enum)
const VOB_TYPE_NAMES: { [key: number]: string } = {
  0: 'zCVob',
  1: 'zCVobLevelCompo',
  2: 'oCItem',
  3: 'oCNpc',
  4: 'zCMoverController',
  5: 'zCVobScreenFX',
  6: 'zCVobStair',
  7: 'zCPFXController',
  8: 'zCVobAnimate',
  9: 'zCVobLensFlare',
  10: 'zCVobLight',
  11: 'zCVobSpot',
  12: 'zCVobStartpoint',
  13: 'zCMessageFilter',
  14: 'zCCodeMaster',
  15: 'zCTriggerWorldStart',
  16: 'zCCSCamera',
  17: 'zCCamTrj_KeyFrame',
  18: 'oCTouchDamage',
  19: 'zCTriggerUntouch',
  20: 'zCEarthquake',
  21: 'oCMOB',
  22: 'oCMobInter',
  23: 'oCMobBed',
  24: 'oCMobFire',
  25: 'oCMobLadder',
  26: 'oCMobSwitch',
  27: 'oCMobWheel',
  28: 'oCMobContainer',
  29: 'oCMobDoor',
  30: 'zCTrigger',
  31: 'zCTriggerList',
  32: 'oCTriggerScript',
  33: 'oCTriggerChangeLevel',
  34: 'oCCSTrigger',
  35: 'zCMover',
  36: 'zCVobSound',
  37: 'zCVobSoundDaytime',
  38: 'oCZoneMusic',
  39: 'oCZoneMusicDefault',
  40: 'zCZoneZFog',
  41: 'zCZoneZFogDefault',
  42: 'zCZoneVobFarPlane',
  43: 'zCZoneVobFarPlaneDefault',
};

/**
 * Gets the VOB type name from a type number
 * @param vobType The VOB type number
 * @returns The uppercase type name (e.g., "ZCVOBSPOT") or null if unknown
 */
export function getVobTypeName(vobType: number | undefined | null): string | null {
  if (vobType === undefined || vobType === null) {
    return null;
  }
  const typeName = VOB_TYPE_NAMES[vobType];
  return typeName ? typeName.toUpperCase() : null;
}

/**
 * Gets the VOB type number from a VOB object
 * @param vob The VOB object
 * @returns The VOB type number or undefined
 */
export function getVobType(vob: Vob): number | undefined {
  return (vob as any).type;
}

/**
 * VOB types that should NOT use helper visuals when they don't have a normal visual
 * These types should be skipped entirely if they don't have a visual
 */
const NON_HELPER_VOB_TYPES = new Set([0, 2, 3, 6]); // zCVob, oCItem, oCNpc, zCVobStair

/**
 * Checks if a VOB type should use helper visuals
 * @param vobType The VOB type number
 * @returns True if this VOB type should use helper visuals, false otherwise
 */
export function shouldUseHelperVisual(vobType: number | undefined | null): boolean {
  if (vobType === undefined || vobType === null) {
    return false;
  }
  return !NON_HELPER_VOB_TYPES.has(vobType);
}

/**
 * Logs all details about a selected VOB to the console
 */
export function logVobDetails(vob: Vob): void {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📦 SELECTED VOB DETAILS');
  console.log('═══════════════════════════════════════════════════════════');
  
  // Basic info
  console.log(`ID: ${vob.id}`);
  console.log(`Show Visual: ${vob.showVisual}`);
  
  // VOB type (if available)
  const vobType = getVobType(vob);
  if (vobType !== undefined) {
    const vobTypeName = getVobTypeName(vobType) || `UNKNOWN(${vobType})`;
    console.log(`VOB Type: ${vobTypeName} (${vobType})`);
  }
  
  // Visual properties
  if (vob.visual) {
    const visualTypeNames = ['DECAL', 'MESH', 'MULTI_RES_MESH', 'PARTICLE_EFFECT', 'AI_CAMERA', 'MODEL', 'MORPH_MESH', 'UNKNOWN'];
    const visualTypeName = visualTypeNames[vob.visual.type] || `UNKNOWN(${vob.visual.type})`;
    console.log(`Visual Type: ${visualTypeName} (${vob.visual.type})`);
    console.log(`Visual Name: ${vob.visual.name || '(none)'}`);
  }
  
  // Name properties
  const nameProps: string[] = [];
  if (vob.objectName) nameProps.push(`objectName: "${vob.objectName}"`);
  if (vob.name) nameProps.push(`name: "${vob.name}"`);
  if (vob.vobName) nameProps.push(`vobName: "${vob.vobName}"`);
  if (nameProps.length > 0) {
    console.log(`Names: ${nameProps.join(', ')}`);
  }
  
  // Children count
  const childCount = vob.children ? vob.children.size() : 0;
  console.log(`Children: ${childCount}`);
  
  // Full VOB object (for inspection)
  console.log('Full VOB Object:', vob);
  
  console.log('═══════════════════════════════════════════════════════════');
}

// Path resolution functions
export const getMeshPath = (visualName: string): string | null => {
  if (!visualName || typeof visualName !== 'string') return null;

  const upper = visualName.toUpperCase();

  // Remove extension and get base name (including .MRM and .MSH if present)
  const base = upper.replace(/\.(3DS|MMS|ASC|TGA|MRM|MSH)$/i, '');

  // Meshes don't have -C suffix like textures do
  // Try .MRM (Multi-Resolution Mesh) first, then .MSH
  const possiblePaths = [
    `/MESHES/_COMPILED/${base}.MRM`,
    `/MESHES/_COMPILED/${base}.MSH`,
  ];

  // For now, return the first possibility (we'll check existence in fetch)
  return possiblePaths[0];
};

export const getModelPath = (visualName: string): string | null => {
  if (!visualName || typeof visualName !== 'string') return null;

  const upper = visualName.toUpperCase();

  // Remove extension if present and get base name
  const base = upper.replace(/\.(MDL|MDS|3DS|MMS|ASC|TGA)$/i, '');

  // Interactive models are stored in ANIMS/_COMPILED folder as .MDL files
  const modelPath = `/ANIMS/_COMPILED/${base}.MDL`;

  return modelPath;
};

export const getMorphMeshPath = (visualName: string): string | null => {
  if (!visualName || typeof visualName !== 'string') return null;

  const upper = visualName.toUpperCase();

  // Remove extension if present and get base name
  const base = upper.replace(/\.(MMB|MMS|MMSB|MDS|3DS|ASC|TGA)$/i, '');

  // Morph meshes are stored in ANIMS/_COMPILED folder as .MMB files
  const morphPath = `/ANIMS/_COMPILED/${base}.MMB`;

  return morphPath;
};

// Helper function to convert TGA texture name to compiled TEX URL
export const tgaNameToCompiledUrl = (name: string): string | null => {
  if (!name || typeof name !== 'string') return null;
  const base = name.replace(/\.[^.]*$/, '').toUpperCase();
  return `/TEXTURES/_COMPILED/${base}-C.TEX`;
};
