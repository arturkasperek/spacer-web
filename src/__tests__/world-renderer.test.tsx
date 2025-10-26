import { render, screen, waitFor } from '@testing-library/react';
import { WorldRenderer } from '../world-renderer';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleError = jest.fn();

beforeAll(() => {
  console.log = mockConsoleLog;
  console.warn = mockConsoleWarn;
  console.error = mockConsoleError;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockClear();
});

describe('WorldRenderer', () => {
  const mockOnLoadingStatus = jest.fn();
  const mockWorldPath = '/test/world.zen';

  it('renders without crashing', () => {
    render(<WorldRenderer worldPath={mockWorldPath} onLoadingStatus={mockOnLoadingStatus} />);
    // Component renders without throwing
    expect(mockOnLoadingStatus).toHaveBeenCalledWith('Loading ZenKit...');
  });

  it('accepts worldPath and onLoadingStatus props', () => {
    const { rerender } = render(<WorldRenderer worldPath={mockWorldPath} onLoadingStatus={mockOnLoadingStatus} />);

    // Can rerender with different props
    rerender(<WorldRenderer worldPath="/different/path.zen" onLoadingStatus={jest.fn()} />);
  });
});

describe('tgaNameToCompiledUrl', () => {
  // Import the helper function for testing
  const { tgaNameToCompiledUrl } = require('../world-renderer');

  it('converts TGA filename to compiled TEX URL', () => {
    expect(tgaNameToCompiledUrl('test.TGA')).toBe('/TEXTURES/_COMPILED/TEST-C.TEX');
    expect(tgaNameToCompiledUrl('MyTexture.tga')).toBe('/TEXTURES/_COMPILED/MYTEXTURE-C.TEX');
  });

  it('handles filenames without extensions', () => {
    expect(tgaNameToCompiledUrl('test')).toBe('/TEXTURES/_COMPILED/TEST-C.TEX');
  });

  it('returns null for invalid input', () => {
    expect(tgaNameToCompiledUrl('')).toBeNull();
    expect(tgaNameToCompiledUrl(null as any)).toBeNull();
    expect(tgaNameToCompiledUrl(undefined as any)).toBeNull();
  });
});
