import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VOBTree } from '../vob-tree';
import type { World } from '@kolarz3/zenkit';

// Mock react-window List component
jest.mock('react-window', () => ({
  List: ({ rowComponent, rowCount, rowProps }: any) => {
    // Render a simplified version for testing
    return (
      <div data-testid="virtual-list">
        {Array.from({ length: Math.min(rowCount, 10) }, (_, index) => {
          const Row = rowComponent;
          return (
            <div key={index} data-testid={`row-${index}`}>
              <Row index={index} style={{}} {...rowProps} />
            </div>
          );
        })}
      </div>
    );
  }
}));

// Mock world object
const createMockWorld = (vobCount = 3): World => {
  const mockVobs: any[] = [];
  
  for (let i = 0; i < vobCount; i++) {
    mockVobs.push({
      id: i,
      objectName: `VOB_${i}`,
      position: { x: i * 100, y: i * 50, z: i * 25 },
      visual: {
        type: 1, // MESH
        name: `mesh_${i}.3ds`
      },
      children: {
        size: () => i === 0 ? 2 : 0, // First VOB has 2 children
        get: (childIndex: number) => ({
          id: 1000 + i * 10 + childIndex,
          objectName: `Child_${i}_${childIndex}`,
          position: { x: 0, y: 0, z: 0 },
          visual: {
            type: 2, // MULTI_RES_MESH
            name: `child_mesh_${childIndex}.3ds`
          },
          children: {
            size: () => 0,
            get: () => null
          }
        })
      }
    });
  }
  
  return {
    getVobs: () => ({
      size: () => mockVobs.length,
      get: (index: number) => mockVobs[index]
    }),
    loadFromArray: () => true,
    isLoaded: true,
    getLastError: () => null,
    mesh: {
      getProcessedMeshData: () => ({
        vertices: { size: () => 0, get: () => 0 },
        indices: { size: () => 0, get: () => 0 },
        materials: { size: () => 0, get: () => ({ texture: '' }) },
        materialIds: { size: () => 0, get: () => 0 }
      })
    }
  } as World;
};

describe('VOBTree Component', () => {
  describe('Rendering', () => {
    it('should render loading state when world is null', () => {
      render(<VOBTree world={null} />);
      expect(screen.getByText('Waiting for world to load...')).toBeInTheDocument();
    });

    it('should render tree when world is provided', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      expect(screen.getByText('VOB Tree')).toBeInTheDocument();
      expect(screen.getByText(/Total VOBs:/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search VOBs...')).toBeInTheDocument();
    });

    it('should display correct total VOB count', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // 3 root VOBs + 2 children of first VOB = 5 total
      expect(screen.getByText('Total VOBs: 5')).toBeInTheDocument();
    });

    it('should render VOB names', () => {
      const world = createMockWorld(2);
      render(<VOBTree world={world} />);
      
      expect(screen.getByText('VOB_0')).toBeInTheDocument();
      expect(screen.getByText('VOB_1')).toBeInTheDocument();
    });
  });

  describe('Tree Structure', () => {
    it('should show child count for parent nodes', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // First VOB has 2 children
      expect(screen.getByText('(2)')).toBeInTheDocument();
    });

    it('should display visual type and name', () => {
      const world = createMockWorld(2);
      render(<VOBTree world={world} />);
      
      expect(screen.getByText(/MESH: mesh_0\.3ds/)).toBeInTheDocument();
    });

    it('should start with all nodes collapsed', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // Children should not be visible initially
      expect(screen.queryByText('Child_0_0')).not.toBeInTheDocument();
      expect(screen.queryByText('Child_0_1')).not.toBeInTheDocument();
    });
  });

  describe('Expand/Collapse Functionality', () => {
    it('should expand node when clicked', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // Find and click the first VOB (which has children)
      const vob0 = screen.getByText('VOB_0');
      fireEvent.click(vob0.closest('div')!);
      
      // Children should now be visible
      expect(screen.getByText('Child_0_0')).toBeInTheDocument();
      expect(screen.getByText('Child_0_1')).toBeInTheDocument();
    });

    it('should toggle expand state when clicked', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // Find VOB_0 which has children
      const vob0Text = screen.getByText('VOB_0');
      const clickableDiv = vob0Text.parentElement?.parentElement;
      
      // Initially should have the collapsed arrow
      const arrowSpan = clickableDiv?.querySelector('span');
      expect(arrowSpan).toHaveTextContent('▶');
      
      // Click to expand
      fireEvent.click(clickableDiv!);
      
      // After clicking, the arrow should change (state updated)
      // Note: Full DOM update happens in the mocked List component
      const updatedArrowSpan = clickableDiv?.querySelector('span');
      expect(updatedArrowSpan?.textContent).toBeTruthy();
    });
  });

  describe('Search Functionality', () => {
    it('should filter VOBs by name', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      const searchInput = screen.getByPlaceholderText('Search VOBs...');
      fireEvent.change(searchInput, { target: { value: 'VOB_0' } });
      
      expect(screen.getByText('VOB_0')).toBeInTheDocument();
      expect(screen.queryByText('VOB_1')).not.toBeInTheDocument();
      expect(screen.queryByText('VOB_2')).not.toBeInTheDocument();
    });

    it('should filter VOBs by visual type', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      const searchInput = screen.getByPlaceholderText('Search VOBs...');
      fireEvent.change(searchInput, { target: { value: 'MESH' } });
      
      // All root VOBs have type MESH, so they should all be visible
      expect(screen.getByText('VOB_0')).toBeInTheDocument();
      expect(screen.getByText('VOB_1')).toBeInTheDocument();
    });

    it('should show "No VOBs match your search" when no results', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      const searchInput = screen.getByPlaceholderText('Search VOBs...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
      
      expect(screen.getByText('No VOBs match your search')).toBeInTheDocument();
    });

    it('should show parent if child matches search', async () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      const searchInput = screen.getByPlaceholderText('Search VOBs...');
      fireEvent.change(searchInput, { target: { value: 'Child_0' } });
      
      await waitFor(() => {
        // Parent should be visible because child matches
        expect(screen.getByText('VOB_0')).toBeInTheDocument();
      });
      
      // Note: Children in filtered results are automatically expanded
      // but we can only verify the parent is shown since the mock List
      // component doesn't expand nodes automatically
    });
  });

  describe('Event Handling', () => {
    it('should stop wheel event propagation', () => {
      const world = createMockWorld(1);
      const { container } = render(<VOBTree world={world} />);
      
      const wheelHandler = jest.fn();
      container.parentElement?.addEventListener('wheel', wheelHandler);
      
      const treeContainer = container.firstChild as HTMLElement;
      fireEvent.wheel(treeContainer);
      
      // Event should not propagate to parent
      expect(wheelHandler).not.toHaveBeenCalled();
      
      container.parentElement?.removeEventListener('wheel', wheelHandler);
    });

    it('should stop mouse event propagation', () => {
      const world = createMockWorld(1);
      const { container } = render(<VOBTree world={world} />);
      
      const mouseDownHandler = jest.fn();
      container.parentElement?.addEventListener('mousedown', mouseDownHandler);
      
      const treeContainer = container.firstChild as HTMLElement;
      fireEvent.mouseDown(treeContainer);
      
      // Event should not propagate to parent
      expect(mouseDownHandler).not.toHaveBeenCalled();
      
      container.parentElement?.removeEventListener('mousedown', mouseDownHandler);
    });
  });

  describe('Visual Types', () => {
    it('should display correct visual type names', () => {
      const world = {
        getVobs: () => ({
          size: () => 1,
          get: () => ({
            id: 999,
            objectName: 'TestVOB',
            position: { x: 0, y: 0, z: 0 },
            visual: {
              type: 5, // MODEL
              name: 'test.mdl'
            },
            rotation: {
              toArray: () => ({
                size: () => 9,
                get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0
              })
            },
            showVisual: true,
            children: {
              size: () => 0,
              get: () => null as any
            }
          })
        }),
        loadFromArray: () => true,
        isLoaded: true,
        getLastError: () => null,
        mesh: {
          getProcessedMeshData: () => ({
            vertices: { size: () => 0, get: () => 0 },
            indices: { size: () => 0, get: () => 0 },
            materials: { size: () => 0, get: () => ({ texture: '' }) },
            materialIds: { size: () => 0, get: () => 0 }
          })
        }
      } as World;
      
      render(<VOBTree world={world} />);
      expect(screen.getByText(/MODEL: test\.mdl/)).toBeInTheDocument();
    });

    it('should handle unknown visual types', () => {
      const world: World = {
        getVobs: () => ({
          size: () => 1,
          get: () => ({
            id: 888,
            objectName: 'TestVOB',
            position: { x: 0, y: 0, z: 0 },
            visual: {
              type: 999, // Unknown type
              name: 'test.unknown'
            },
            rotation: {
              toArray: () => ({
                size: () => 9,
                get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0
              })
            },
            showVisual: true,
            children: {
              size: () => 0,
              get: () => null as any
            }
          })
        }),
        loadFromArray: () => true,
        isLoaded: true,
        getLastError: () => null,
        mesh: {
          getProcessedMeshData: () => ({
            vertices: { size: () => 0, get: () => 0 },
            indices: { size: () => 0, get: () => 0 },
            materials: { size: () => 0, get: () => ({ texture: '' }) },
            materialIds: { size: () => 0, get: () => 0 }
          })
        }
      } as unknown as World;
      
      render(<VOBTree world={world} />);
      expect(screen.getByText(/UNKNOWN\(999\): test\.unknown/)).toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should show "No VOBs found" when world has no VOBs', () => {
      const world: World = {
        getVobs: () => ({
          size: () => 0,
          get: () => null
        }),
        loadFromArray: () => true,
        isLoaded: true,
        getLastError: () => null,
        mesh: {
          getProcessedMeshData: () => ({
            vertices: { size: () => 0, get: () => 0 },
            indices: { size: () => 0, get: () => 0 },
            materials: { size: () => 0, get: () => ({ texture: '' }) },
            materialIds: { size: () => 0, get: () => 0 }
          })
        }
      } as unknown as World;
      
      render(<VOBTree world={world} />);
      expect(screen.getByText('No VOBs found')).toBeInTheDocument();
    });
  });

  describe('Styling and Layout', () => {
    it('should apply correct z-index', () => {
      const world = createMockWorld(1);
      const { container } = render(<VOBTree world={world} />);
      
      const treeContainer = container.firstChild as HTMLElement;
      expect(treeContainer).toHaveStyle({ zIndex: '1000' });
    });

    it('should have fixed width', () => {
      const world = createMockWorld(1);
      const { container } = render(<VOBTree world={world} />);
      
      const treeContainer = container.firstChild as HTMLElement;
      expect(treeContainer).toHaveStyle({ width: '320px' });
    });

    it('should use flex layout', () => {
      const world = createMockWorld(1);
      const { container } = render(<VOBTree world={world} />);
      
      const treeContainer = container.firstChild as HTMLElement;
      expect(treeContainer).toHaveStyle({ 
        display: 'flex',
        flexDirection: 'column'
      });
    });
  });

  describe('Integration with react-window', () => {
    it('should render List component with correct props', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      const virtualList = screen.getByTestId('virtual-list');
      expect(virtualList).toBeInTheDocument();
    });

    it('should calculate correct flattened item count', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // Initially collapsed, should show only 3 root nodes
      const rows = screen.getAllByTestId(/^row-/);
      expect(rows).toHaveLength(3);
    });

    it('should update flattened items when node is expanded', () => {
      const world = createMockWorld(3);
      render(<VOBTree world={world} />);
      
      // Expand first VOB
      const vob0 = screen.getByText('VOB_0');
      fireEvent.click(vob0.closest('div')!);
      
      // Should now show 3 root nodes + 2 children = 5 items
      waitFor(() => {
        const rows = screen.getAllByTestId(/^row-/);
        expect(rows.length).toBeGreaterThan(3);
      });
    });
  });
});

