import React, { useState, useMemo, useRef, useCallback, useEffect, CSSProperties } from "react";
import { List } from 'react-window';
import type { World, Vob } from '@kolarz3/zenkit';

interface VOBNode {
  id: string;
  vob: Vob;
  name: string;
  visualName: string;
  visualType: string;
  children: VOBNode[];
  position: { x: number; y: number; z: number };
}

interface FlattenedNode {
  node: VOBNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

interface VOBTreeProps {
  world: World | null;
  onVobClick?: (vob: Vob) => void;
  selectedVob?: Vob | null;
}

function buildVOBTree(world: World): VOBNode[] {
  if (!world) return [];

  const vobs = world.getVobs();
  const vobCount = vobs.size();
  const typeNames = ['DECAL', 'MESH', 'MULTI_RES_MESH', 'PARTICLE', 'CAMERA', 'MODEL', 'MORPH_MESH', 'UNKNOWN'];

  const buildNode = (vob: Vob, index: number, depth: number): VOBNode => {
    const visualType = vob.visual?.type !== undefined ? vob.visual.type : -1;
    const visualTypeName = visualType >= 0 && visualType < typeNames.length 
      ? typeNames[visualType] 
      : `UNKNOWN(${visualType})`;

    const children: VOBNode[] = [];
    const childCount = vob.children?.size() || 0;
    for (let i = 0; i < childCount; i++) {
      const childVob = vob.children.get(i);
      children.push(buildNode(childVob, i, depth + 1));
    }

    // Try to get VOB name from different possible properties
    let vobName = 'Unnamed';
    if (vob.objectName) {
      vobName = vob.objectName;
    } else if (vob.name) {
      vobName = vob.name;
    } else if (vob.vobName) {
      vobName = vob.vobName;
    }

    return {
      id: `vob_${depth}_${index}`,
      vob,
      name: vobName,
      visualName: vob.visual?.name || '',
      visualType: visualTypeName,
      children,
      position: {
        x: vob.position?.x || 0,
        y: vob.position?.y || 0,
        z: vob.position?.z || 0,
      }
    };
  };

  const rootNodes: VOBNode[] = [];
  for (let i = 0; i < vobCount; i++) {
    const vob = vobs.get(i);
    rootNodes.push(buildNode(vob, i, 0));
  }

  return rootNodes;
}

// Flatten tree into a list of visible nodes based on expanded state
function flattenTree(
  nodes: VOBNode[],
  expandedIds: Set<string>,
  depth: number = 0
): FlattenedNode[] {
  const result: FlattenedNode[] = [];
  
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    
    result.push({
      node,
      depth,
      hasChildren,
      isExpanded
    });
    
    // If expanded, add children
    if (isExpanded && hasChildren) {
      result.push(...flattenTree(node.children, expandedIds, depth + 1));
    }
  }
  
  return result;
}

export function VOBTree({ world, onVobClick, selectedVob }: VOBTreeProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<any>(null);

  const vobTree = useMemo(() => {
    if (!world) return [];
    console.log('Building VOB tree...');
    const tree = buildVOBTree(world);
    console.log(`VOB tree built: ${tree.length} root nodes`);
    return tree;
  }, [world]);

  const filterTree = (nodes: VOBNode[], searchTerm: string): VOBNode[] => {
    if (!searchTerm) return nodes;

    const search = searchTerm.toLowerCase();
    
    const filterNode = (node: VOBNode): VOBNode | null => {
      const matches = 
        node.name.toLowerCase().includes(search) ||
        node.visualName.toLowerCase().includes(search) ||
        node.visualType.toLowerCase().includes(search);

      const filteredChildren = node.children
        .map(child => filterNode(child))
        .filter((child): child is VOBNode => child !== null);

      if (matches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren
        };
      }

      return null;
    };

    return nodes
      .map(node => filterNode(node))
      .filter((node): node is VOBNode => node !== null);
  };

  const filteredTree = useMemo(
    () => filterTree(vobTree, searchTerm),
    [vobTree, searchTerm]
  );

  const totalCount = useMemo(() => {
    const countNodes = (nodes: VOBNode[]): number => {
      return nodes.reduce((sum, node) => {
        return sum + 1 + countNodes(node.children);
      }, 0);
    };
    return countNodes(vobTree);
  }, [vobTree]);

  // Flatten the tree for virtual scrolling
  const flattenedItems = useMemo(
    () => flattenTree(filteredTree, expandedIds),
    [filteredTree, expandedIds]
  );

  // Toggle node expansion
  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Find VOB node in tree recursively
  const findVobInTree = useCallback((vob: Vob, nodes: VOBNode[]): VOBNode | null => {
    for (const node of nodes) {
      if (node.vob.id === vob.id) {
        return node;
      }
      const found = findVobInTree(vob, node.children);
      if (found) {
        return found;
      }
    }
    return null;
  }, []);

  // Track last selected VOB to avoid re-navigating
  const lastSelectedVobRef = useRef<Vob | null>(null);
  const expandedIdsRef = useRef<Set<string>>(new Set());

  // Sync expandedIds to ref
  useEffect(() => {
    expandedIdsRef.current = expandedIds;
  }, [expandedIds]);

  // Navigate to selected VOB when it changes
  useEffect(() => {
    if (!selectedVob || !listRef.current || filteredTree.length === 0) {
      return;
    }

    // Skip if this is the same VOB we already navigated to
    if (lastSelectedVobRef.current?.id === selectedVob.id) {
      return;
    }

    // Find the VOB in the tree
    const foundNode = findVobInTree(selectedVob, filteredTree);
    if (!foundNode) {
      return;
    }

    // Mark as navigated
    lastSelectedVobRef.current = selectedVob;

    // Find all parent nodes that need to be expanded
    const findParents = (targetNode: VOBNode, nodes: VOBNode[], path: VOBNode[] = []): VOBNode[] => {
      for (const node of nodes) {
        if (node.id === targetNode.id) {
          return path;
        }
        const found = findVobInTree(targetNode.vob, [node]);
        if (found) {
          const newPath = [...path, node];
          if (node.id !== targetNode.id && node.children.length > 0) {
            return findParents(targetNode, node.children, newPath);
          }
          return newPath;
        }
      }
      return path;
    };

    const parentsToExpand = findParents(foundNode, filteredTree);
    
    // Create set of IDs that should be expanded (only the path to target)
    const idsToKeepExpanded = new Set<string>();
    for (const parent of parentsToExpand) {
      idsToKeepExpanded.add(parent.id);
    }

    // First, collapse all other groups (keep only the path to target)
    setExpandedIds(prev => {
      const next = new Set<string>();
      // Only keep the IDs that are in the path to the target
      for (const id of prev) {
        if (idsToKeepExpanded.has(id)) {
          next.add(id);
        }
      }
      // Add any parents that weren't already expanded
      for (const parent of parentsToExpand) {
        next.add(parent.id);
      }
      return next;
    });

    // Wait for collapse/expansion to complete, then scroll to item
    const scrollTimeout = setTimeout(() => {
      // Calculate the flattened list with only the path expanded
      const updatedFlattened = flattenTree(filteredTree, idsToKeepExpanded);
      const index = updatedFlattened.findIndex(item => item.node.id === foundNode.id);
      
      // Check if listRef is set and has scrollToRow method (react-window v2 API)
      if (index >= 0 && listRef.current) {
        const listInstance = listRef.current as any;
        // react-window v2 uses scrollToRow instead of scrollToItem
        listInstance.scrollToRow({
          index: index,
          align: 'smart',
          behavior: 'auto'
        });
      }
    }, 200);

    return () => clearTimeout(scrollTimeout);
  }, [selectedVob?.id, filteredTree, findVobInTree]);

  // Calculate item height - larger if it has visual name
  const getItemSize = useCallback((index: number) => {
    const item = flattenedItems[index];
    return item?.node.visualName ? 48 : 32;
  }, [flattenedItems]);

  // Row component for react-window v2
  const RowComponent = useCallback(({ index, style }: { index: number; style: CSSProperties }) => {
    const item = flattenedItems[index];
    if (!item) return <div style={style} />;
    
    const { node, depth, hasChildren, isExpanded } = item;
    const isSelected = selectedVob && node.vob.id === selectedVob.id;
    
    return (
      <div
        style={{
          ...style,
          paddingLeft: `${depth * 16 + 8}px`,
          paddingRight: '8px'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            cursor: 'pointer', // All items are clickable
            borderRadius: '4px',
            height: '100%',
            boxSizing: 'border-box',
            backgroundColor: isSelected ? 'rgba(255, 255, 0, 0.3)' : 'transparent',
            borderLeft: isSelected ? '3px solid #ffff00' : '3px solid transparent'
          }}
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(node.id);
            } else {
              // If no children, teleport to VOB position
              onVobClick?.(node.vob);
            }
          }}
          onDoubleClick={() => {
            // Double-click always teleports, even for parent nodes
            onVobClick?.(node.vob);
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'rgba(100, 150, 255, 0.2)'; // Slightly blue highlight
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'transparent';
            } else {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 0, 0.3)'; // Keep yellow highlight
            }
          }}
        >
          <span style={{ 
            marginRight: '6px', 
            width: '12px',
            textAlign: 'center',
            fontSize: '10px',
            userSelect: 'none'
          }}>
            {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
          </span>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ 
              fontSize: '12px', 
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {node.name}
            </div>
            {node.visualName && (
              <div style={{ 
                fontSize: '10px', 
                color: 'rgba(255, 255, 255, 0.6)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {node.visualType}: {node.visualName}
              </div>
            )}
          </div>
          {hasChildren && (
            <span style={{ 
              fontSize: '10px', 
              color: 'rgba(255, 255, 255, 0.5)',
              marginLeft: '8px'
            }}>
              ({node.children.length})
            </span>
          )}
        </div>
      </div>
    );
  }, [flattenedItems, toggleExpanded, onVobClick, selectedVob]);

  if (!world) {
    return (
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '320px',
        background: 'rgba(0, 0, 0, 0.85)',
        color: 'white',
        fontFamily: 'monospace',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        zIndex: 1000,
        borderRight: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        Waiting for world to load...
      </div>
    );
  }

  return (
    <div 
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '320px',
        background: 'rgba(0, 0, 0, 0.85)',
        color: 'white',
        fontFamily: 'monospace',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
        borderRight: '1px solid rgba(255, 255, 255, 0.1)'
      }}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(0, 0, 0, 0.5)'
      }}>
        <h3 style={{ 
          margin: '0 0 8px 0', 
          fontSize: '14px',
          fontWeight: 'bold'
        }}>
          VOB Tree
        </h3>
        <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>
          Total VOBs: {totalCount}
        </div>
        <div style={{ 
          fontSize: '10px', 
          color: 'rgba(150, 200, 255, 0.8)',
          marginTop: '4px',
          fontStyle: 'italic'
        }}>
          Click: expand | Double-click: teleport
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <input
          type="text"
          placeholder="Search VOBs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '4px',
            color: 'white',
            fontSize: '12px',
            fontFamily: 'monospace',
            outline: 'none'
          }}
          onFocus={(e) => {
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.4)';
            e.target.style.background = 'rgba(255, 255, 255, 0.15)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            e.target.style.background = 'rgba(255, 255, 255, 0.1)';
          }}
        />
      </div>

      {/* Tree */}
      <div 
        style={{
          flex: 1,
          minHeight: 0
        }}
      >
        {flattenedItems.length > 0 ? (
          <List<Record<string, never>>
            listRef={listRef}
            rowComponent={RowComponent as (props: { index: number; style: CSSProperties } & Record<string, never>) => React.ReactElement}
            rowCount={flattenedItems.length}
            rowHeight={getItemSize}
            rowProps={{} as Record<string, never>}
            overscanCount={5}
          />
        ) : (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '12px'
          }}>
            {searchTerm ? 'No VOBs match your search' : 'No VOBs found'}
          </div>
        )}
      </div>
    </div>
  );
}

