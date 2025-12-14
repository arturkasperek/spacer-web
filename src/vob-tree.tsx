import React, { useState, useMemo, useRef, useCallback, useEffect, CSSProperties } from "react";
import { List } from 'react-window';
import type { World, Vob, WayPointData } from '@kolarz3/zenkit';
import { getVobTypeName, getVobType } from './vob-utils';

type TreeNodeKind = 'group' | 'vob' | 'waypoint';

interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  name: string;
  children: TreeNode[];
  position: { x: number; y: number; z: number };

  // VOB-only fields
  vob?: Vob;
  visualName?: string;
  visualType?: string;
  vobType?: number | undefined;
  vobName?: string | undefined;

  // Waypoint-only fields
  waypoint?: WayPointData;
  freePoint?: boolean;
}

interface FlattenedNode {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

interface VOBTreeProps {
  world: World | null;
  onVobClick?: (vob: Vob) => void;
  onWaypointSelect?: (waypoint: WayPointData) => void;
  onWaypointTeleport?: (waypoint: WayPointData) => void;
  selectedVob?: Vob | null;
  selectedWaypoint?: WayPointData | null;
}

function buildVOBTree(world: World): TreeNode[] {
  if (!world) return [];

  const vobs = world.getVobs();
  const vobCount = vobs.size();
  const typeNames = ['DECAL', 'MESH', 'MULTI_RES_MESH', 'PARTICLE', 'CAMERA', 'MODEL', 'MORPH_MESH', 'UNKNOWN'];

  const buildNode = (vob: Vob, depth: number, path: string): TreeNode => {
    const visualType = vob.visual?.type !== undefined ? vob.visual.type : -1;
    const visualTypeName = visualType >= 0 && visualType < typeNames.length 
      ? typeNames[visualType] 
      : `UNKNOWN(${visualType})`;

    const children: TreeNode[] = [];
    const childCount = vob.children?.size() || 0;
    for (let i = 0; i < childCount; i++) {
      const childVob = vob.children.get(i);
      children.push(buildNode(childVob, depth + 1, `${path}.${i}`));
    }

    // Get VOB type name
    const vobType = getVobType(vob);
    const vobTypeName = getVobTypeName(vobType);

    // Use VOB type name as the display name, with fallback to vobName
    const displayName = vob.name || vobTypeName || 'Unnamed';

    return {
      // Must be unique across the whole tree (expandedIds + navigation rely on it).
      id: `vob_${vob.id}_${path}`,
      kind: 'vob',
      vob,
      name: displayName,
      visualName: vob.visual?.name || '',
      visualType: visualTypeName,
      vobType: vobType,
      vobName: vob.vobName,
      children,
      position: {
        x: vob.position?.x || 0,
        y: vob.position?.y || 0,
        z: vob.position?.z || 0,
      }
    };
  };

  const rootNodes: TreeNode[] = [];
  for (let i = 0; i < vobCount; i++) {
    const vob = vobs.get(i);
    rootNodes.push(buildNode(vob, 0, `${i}`));
  }

  return rootNodes;
}

function buildWaypointsTree(world: World): TreeNode[] {
  if (!world) return [];

  try {
    const waypointsVector = world.getAllWaypoints() as any;
    if (!waypointsVector || typeof waypointsVector.size !== 'function' || typeof waypointsVector.get !== 'function') {
      return [];
    }

    const waypointCount = waypointsVector.size();
    const nodes: TreeNode[] = [];

    for (let i = 0; i < waypointCount; i++) {
      const wp = waypointsVector.get(i) as WayPointData | null | undefined;
      if (!wp) continue;

      const name = wp.name || `Waypoint_${i}`;
      nodes.push({
        id: `wp_${name}`,
        kind: 'waypoint',
        name,
        waypoint: wp,
        freePoint: !!wp.free_point,
        children: [],
        position: {
          x: wp.position?.x || 0,
          y: wp.position?.y || 0,
          z: wp.position?.z || 0,
        },
      });
    }

    nodes.sort((a, b) => a.name.localeCompare(b.name));
    return nodes;
  } catch (error) {
    console.warn('Failed to load waypoints for tree:', error);
    return [];
  }
}

// Flatten tree into a list of visible nodes based on expanded state
function flattenTree(
  nodes: TreeNode[],
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

export function VOBTree({ world, onVobClick, onWaypointSelect, onWaypointTeleport, selectedVob, selectedWaypoint }: VOBTreeProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<any>(null);

  const vobTree = useMemo(() => {
    if (!world) return [];
    return buildVOBTree(world);
  }, [world]);

  const waypointTree = useMemo(() => {
    if (!world) return [];
    return buildWaypointsTree(world);
  }, [world]);

  const rootTree = useMemo<TreeNode[]>(() => {
    if (!world) return [];
    return [
      {
        id: 'group_waypoints',
        kind: 'group',
        name: 'Waypoints',
        children: waypointTree,
        position: { x: 0, y: 0, z: 0 },
      },
      ...vobTree,
    ];
  }, [world, waypointTree, vobTree]);

  const filterTree = (nodes: TreeNode[], searchTerm: string): TreeNode[] => {
    if (!searchTerm) return nodes;

    const search = searchTerm.toLowerCase();
    
    const filterNode = (node: TreeNode): TreeNode | null => {
      const matches = 
        node.name.toLowerCase().includes(search) ||
        (node.visualName?.toLowerCase().includes(search) || false) ||
        (node.visualType?.toLowerCase().includes(search) || false) ||
        (node.vobName?.toLowerCase().includes(search) || false);

      const filteredChildren = node.children
        .map(child => filterNode(child))
        .filter((child): child is TreeNode => child !== null);

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
      .filter((node): node is TreeNode => node !== null);
  };

  const filteredTree = useMemo(
    () => filterTree(rootTree, searchTerm),
    [rootTree, searchTerm]
  );

  const totalCount = useMemo(() => {
    const countNodes = (nodes: TreeNode[]): number => {
      return nodes.reduce((sum, node) => {
        return sum + 1 + countNodes(node.children);
      }, 0);
    };
    return countNodes(vobTree);
  }, [vobTree]);

  const waypointCount = waypointTree.length;

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
  const findVobInTree = useCallback((vob: Vob, nodes: TreeNode[]): TreeNode | null => {
    for (const node of nodes) {
      if (node.kind === 'vob' && node.vob?.id === vob.id) {
        return node;
      }
      const found = findVobInTree(vob, node.children);
      if (found) {
        return found;
      }
    }
    return null;
  }, []);

  const findWaypointInTree = useCallback((waypointName: string, nodes: TreeNode[]): TreeNode | null => {
    for (const node of nodes) {
      if (node.kind === 'waypoint' && node.waypoint?.name === waypointName) {
        return node;
      }
      const found = findWaypointInTree(waypointName, node.children);
      if (found) {
        return found;
      }
    }
    return null;
  }, []);

  const findPathToNode = useCallback((targetNode: TreeNode, nodes: TreeNode[], path: TreeNode[] = []): TreeNode[] | null => {
    for (const node of nodes) {
      const nextPath = [...path, node];
      if (node === targetNode) {
        return nextPath;
      }
      const found = findPathToNode(targetNode, node.children, nextPath);
      if (found) {
        return found;
      }
    }
    return null;
  }, []);

  // Track last selected VOB to avoid re-navigating
  const lastSelectedVobRef = useRef<Vob | null>(null);
  const lastSelectedWaypointNameRef = useRef<string | null>(null);
  const expandedIdsRef = useRef<Set<string>>(new Set());

  // Sync expandedIds to ref
  useEffect(() => {
    expandedIdsRef.current = expandedIds;
  }, [expandedIds]);

  const navigateToNode = useCallback((foundNode: TreeNode) => {
    const path = findPathToNode(foundNode, filteredTree);
    if (!path || path.length === 0) return;

    const parentsToExpand = path.slice(0, -1);

    // Create set of IDs that should be expanded (only the path to target)
    const idsToKeepExpanded = new Set<string>();
    for (const parent of parentsToExpand) {
      idsToKeepExpanded.add(parent.id);
    }
    // Also include the target node itself if it has children (to keep it expanded)
    if (foundNode.children.length > 0) {
      idsToKeepExpanded.add(foundNode.id);
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
      // Add the target node itself if it has children
      if (foundNode.children.length > 0) {
        next.add(foundNode.id);
      }
      return next;
    });

    // Wait for collapse/expansion to complete, then scroll to item
    const scrollTimeout = setTimeout(() => {
      const updatedFlattened = flattenTree(filteredTree, idsToKeepExpanded);
      const index = updatedFlattened.findIndex(item => item.node.id === foundNode.id);

      if (index >= 0 && listRef.current) {
        const listInstance = listRef.current as any;
        listInstance.scrollToRow({
          index: index,
          align: 'smart',
          behavior: 'auto'
        });
      }
    }, 200);

    return () => clearTimeout(scrollTimeout);
  }, [filteredTree, findPathToNode]);

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
    return navigateToNode(foundNode);
  }, [selectedVob?.id, filteredTree, findVobInTree, navigateToNode]);

  // Navigate to selected waypoint when it changes
  useEffect(() => {
    const selectedName = selectedWaypoint?.name;
    if (!selectedName || !listRef.current || filteredTree.length === 0) {
      return;
    }

    if (lastSelectedWaypointNameRef.current === selectedName) {
      return;
    }

    const foundNode = findWaypointInTree(selectedName, filteredTree);
    if (!foundNode) {
      return;
    }

    lastSelectedWaypointNameRef.current = selectedName;
    return navigateToNode(foundNode);
  }, [selectedWaypoint?.name, filteredTree, findWaypointInTree, navigateToNode]);

  // Calculate item height - larger if it has visual name or vobName (for VOB spots)
  const getItemSize = useCallback((index: number) => {
    const item = flattenedItems[index];
    const hasSecondaryText =
      item?.node.kind === 'waypoint' ||
      (item?.node.kind === 'vob' &&
        ((item?.node.visualName && item?.node.vobType !== 11) ||
          (item?.node.vobType === 11 && item?.node.vobName)));
    return hasSecondaryText ? 48 : 32;
  }, [flattenedItems]);

  // Row component for react-window v2
  const RowComponent = useCallback(({ index, style }: { index: number; style: CSSProperties }) => {
    const item = flattenedItems[index];
    if (!item) return <div style={style} />;
    
    const { node, depth, hasChildren, isExpanded } = item;
    const isSelectedVob = selectedVob && node.kind === 'vob' && node.vob?.id === selectedVob.id;
    const isSelectedWaypoint = selectedWaypoint?.name && node.kind === 'waypoint' && node.waypoint?.name === selectedWaypoint.name;
    const isSelected = !!isSelectedVob || !!isSelectedWaypoint;
    
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
          onClick={(e) => {
            e.stopPropagation();
            
            if (hasChildren) {
              toggleExpanded(node.id);
              // If MULTI_RES_MESH, also teleport to VOB position
              if (node.kind === 'vob' && node.visualType === 'MULTI_RES_MESH' && node.vob) {
                onVobClick?.(node.vob);
              }
            } else {
              if (node.kind === 'vob' && node.vob) {
                onVobClick?.(node.vob);
              } else if (node.kind === 'waypoint' && node.waypoint) {
                onWaypointSelect?.(node.waypoint);
              }
            }
          }}
          onDoubleClick={() => {
            // Double-click always teleports, even for parent nodes (except groups)
            if (node.kind === 'vob' && node.vob) {
              onVobClick?.(node.vob);
            } else if (node.kind === 'waypoint' && node.waypoint) {
              onWaypointTeleport?.(node.waypoint);
            }
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'rgba(100, 150, 255, 0.2)'; // Slightly blue highlight
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'transparent';
            } else if (isSelectedVob) {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 0, 0.3)'; // Keep yellow highlight
            } else if (isSelectedWaypoint) {
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
            {(() => {
              let secondaryText: string | null = null;

              if (node.kind === 'waypoint') {
                const kindLabel = node.freePoint ? 'Free point' : 'Waypoint';
                const p = node.position;
                secondaryText = `${kindLabel} @ ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`;
              } else if (node.kind === 'vob') {
                const isVobSpot = node.vobType === 11;
                if (isVobSpot && node.vobName) {
                  secondaryText = node.vobName;
                } else if (!isVobSpot && node.visualName) {
                  secondaryText = `${node.visualType}: ${node.visualName}`;
                }
              }
              
              return secondaryText ? (
                <div style={{ 
                  fontSize: '10px', 
                  color: 'rgba(255, 255, 255, 0.6)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {secondaryText}
                </div>
              ) : null;
            })()}
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
  }, [flattenedItems, toggleExpanded, onVobClick, onWaypointSelect, onWaypointTeleport, selectedVob, selectedWaypoint]);

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
        <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>
          Total Waypoints: {waypointCount}
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
          placeholder="Search VOBs/Waypoints..."
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
            {searchTerm ? 'No items match your search' : 'No items found'}
          </div>
        )}
      </div>
    </div>
  );
}
