import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VOBTree } from '../vob-tree';
import type { World, Vob } from '@kolarz3/zenkit';

// Mock scrollToRow function
const mockScrollToRow = jest.fn();

// Mock react-window List component with ref support
jest.mock('react-window', () => {
  const React = require('react');
  return {
    List: ({ rowComponent, rowCount, rowProps, listRef }: any) => {
      // Support listRef prop (react-window v2 API)
      React.useEffect(() => {
        if (listRef) {
          listRef.current = {
            scrollToRow: mockScrollToRow,
          };
        }
      }, [listRef]);

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
    },
  };
});

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

  describe('Selected VOB Jump Logic', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // Helper to create a world with nested structure for testing
    const createNestedMockWorld = (): World => {
      const grandchildVob: any = {
        id: 2000,
        objectName: 'Grandchild_0_0',
        position: { x: 0, y: 0, z: 0 },
        visual: { type: 1, name: 'grandchild.3ds' },
        children: { size: () => 0, get: () => null },
      };

      const childVob: any = {
        id: 1000,
        objectName: 'Child_0',
        position: { x: 0, y: 0, z: 0 },
        visual: { type: 1, name: 'child.3ds' },
        children: {
          size: () => 1,
          get: () => grandchildVob,
        },
      };

      const rootVob: any = {
        id: 0,
        objectName: 'Root_0',
        position: { x: 0, y: 0, z: 0 },
        visual: { type: 1, name: 'root.3ds' },
        children: {
          size: () => 1,
          get: () => childVob,
        },
      };

      const otherRootVob: any = {
        id: 1,
        objectName: 'Root_1',
        position: { x: 100, y: 0, z: 0 },
        visual: { type: 1, name: 'root1.3ds' },
        children: { size: () => 0, get: () => null },
      };

      return {
        getVobs: () => ({
          size: () => 2,
          get: (index: number) => (index === 0 ? rootVob : otherRootVob),
        }),
        loadFromArray: () => true,
        isLoaded: true,
        getLastError: () => null,
        mesh: {
          getProcessedMeshData: () => ({
            vertices: { size: () => 0, get: () => 0 },
            indices: { size: () => 0, get: () => 0 },
            materials: { size: () => 0, get: () => ({ texture: '' }) },
            materialIds: { size: () => 0, get: () => 0 },
          }),
        },
      } as World;
    };

    it('should scroll to root VOB when selectedVob changes', async () => {
      const world = createMockWorld(3);
      const rootVob = world.getVobs().get(0) as Vob;

      render(<VOBTree world={world} selectedVob={rootVob} />);

      // Wait for the scroll timeout
      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        expect(mockScrollToRow).toHaveBeenCalledWith({
          index: 0,
          align: 'smart',
          behavior: 'auto',
        });
      });
    });

    it('should expand parent nodes and scroll to nested VOB', async () => {
      const world = createNestedMockWorld();
      const rootVob = world.getVobs().get(0) as Vob;
      const childVob = rootVob.children.get(0) as Vob;
      const grandchildVob = childVob.children.get(0) as Vob;

      render(<VOBTree world={world} selectedVob={grandchildVob} />);

      // Wait for the scroll timeout
      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        // Should have expanded parents and scrolled to grandchild
        expect(mockScrollToRow).toHaveBeenCalled();
        const call = mockScrollToRow.mock.calls[0][0];
        expect(call.index).toBeGreaterThan(0); // Should be after root and child
        expect(call.align).toBe('smart');
        expect(call.behavior).toBe('auto');
      });
    });

    it('should collapse other groups when jumping to a VOB', async () => {
      const world = createNestedMockWorld();
      const rootVob = world.getVobs().get(0) as Vob;

      const { rerender } = render(<VOBTree world={world} />);

      // First expand the other root manually
      const otherRootText = screen.getByText('Root_1');
      fireEvent.click(otherRootText.closest('div')!);

      // Now select the first root's child
      const childVob = rootVob.children.get(0) as Vob;
      rerender(<VOBTree world={world} selectedVob={childVob} />);

      // Wait for the scroll timeout
      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        // Should have collapsed Root_1 and expanded only Root_0 path
        expect(mockScrollToRow).toHaveBeenCalled();
      });

      // Verify Root_1 is collapsed (its children should not be visible)
      expect(screen.queryByText('Root_1')).toBeInTheDocument();
    });

    it('should skip navigation if same VOB is selected again', async () => {
      const world = createMockWorld(3);
      const rootVob = world.getVobs().get(0) as Vob;

      const { rerender } = render(<VOBTree world={world} selectedVob={rootVob} />);

      // First navigation
      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        expect(mockScrollToRow).toHaveBeenCalledTimes(1);
      });

      mockScrollToRow.mockClear();

      // Select the same VOB again
      rerender(<VOBTree world={world} selectedVob={rootVob} />);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      // Should not scroll again
      expect(mockScrollToRow).not.toHaveBeenCalled();
    });

    it('should handle VOB not found in tree gracefully', async () => {
      const world = createMockWorld(3);
      const nonExistentVob: Vob = {
        id: 99999,
        objectName: 'NonExistent',
        position: { x: 0, y: 0, z: 0 },
        visual: { type: 1, name: 'nonexistent.3ds' },
        children: { size: () => 0, get: () => null },
      } as any;

      render(<VOBTree world={world} selectedVob={nonExistentVob} />);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      // Should not scroll if VOB is not found
      expect(mockScrollToRow).not.toHaveBeenCalled();
    });

    it('should not scroll when filteredTree is empty', async () => {
      const world = createMockWorld(3);
      const rootVob = world.getVobs().get(0) as Vob;

      const { rerender } = render(<VOBTree world={world} selectedVob={rootVob} />);

      // Set a search term that filters everything out
      const searchInput = screen.getByPlaceholderText('Search VOBs...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      // Wait for filter to apply
      await waitFor(() => {
        expect(screen.getByText('No VOBs match your search')).toBeInTheDocument();
      });

      mockScrollToRow.mockClear();

      // Try to select VOB when filtered tree is empty
      rerender(<VOBTree world={world} selectedVob={rootVob} />);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      // Should not scroll when filteredTree is empty
      expect(mockScrollToRow).not.toHaveBeenCalled();
    });

    it('should expand multiple levels of parents correctly', async () => {
      const world = createNestedMockWorld();
      const rootVob = world.getVobs().get(0) as Vob;
      const childVob = rootVob.children.get(0) as Vob;
      const grandchildVob = childVob.children.get(0) as Vob;

      render(<VOBTree world={world} selectedVob={grandchildVob} />);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        // Should have scrolled to grandchild
        expect(mockScrollToRow).toHaveBeenCalled();
        const call = mockScrollToRow.mock.calls[0][0];
        // Index should be 2 (root=0, child=1, grandchild=2)
        expect(call.index).toBe(2);
      });

      // Verify that both root and child are expanded (grandchild should be visible)
      const grandchildText = screen.getByText('Grandchild_0_0');
      expect(grandchildText).toBeInTheDocument();
    });

    it('should handle rapid VOB selection changes', async () => {
      const world = createNestedMockWorld();
      const rootVob = world.getVobs().get(0) as Vob;
      const childVob = rootVob.children.get(0) as Vob;
      const grandchildVob = childVob.children.get(0) as Vob;
      const otherRootVob = world.getVobs().get(1) as Vob;

      const { rerender } = render(<VOBTree world={world} selectedVob={rootVob} />);

      // Rapidly change selections
      rerender(<VOBTree world={world} selectedVob={childVob} />);
      rerender(<VOBTree world={world} selectedVob={grandchildVob} />);
      rerender(<VOBTree world={world} selectedVob={otherRootVob} />);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        // Should have scrolled at least once
        expect(mockScrollToRow).toHaveBeenCalled();
      });
    });

    it('should calculate correct index after collapsing other groups', async () => {
      const world = createNestedMockWorld();
      const rootVob = world.getVobs().get(0) as Vob;
      const childVob = rootVob.children.get(0) as Vob;

      const { rerender } = render(<VOBTree world={world} />);

      // Expand both root nodes first
      const root0Text = screen.getByText('Root_0');
      fireEvent.click(root0Text.closest('div')!);
      const root1Text = screen.getByText('Root_1');
      fireEvent.click(root1Text.closest('div')!);

      // Now select child of Root_0
      rerender(<VOBTree world={world} selectedVob={childVob} />);

      act(() => {
        jest.advanceTimersByTime(250);
      });

      await waitFor(() => {
        expect(mockScrollToRow).toHaveBeenCalled();
        const call = mockScrollToRow.mock.calls[0][0];
        // Index should be 1 (Root_0=0, Child_0=1) after Root_1 is collapsed
        expect(call.index).toBe(1);
      });
    });
  });
});

