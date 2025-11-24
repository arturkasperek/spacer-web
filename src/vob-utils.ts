// VOB utility functions for path resolution and helpers
import type { Vob } from '@kolarz3/zenkit';

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
  const vobType = (vob as any).type;
  if (vobType !== undefined) {
    const vobTypeNames: { [key: number]: string } = {
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
    };
    const vobTypeName = vobTypeNames[vobType] || `UNKNOWN(${vobType})`;
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
