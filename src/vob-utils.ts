// VOB utility functions for path resolution and helpers

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
