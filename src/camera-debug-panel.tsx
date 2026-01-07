import { useState } from 'react';
import { useCameraDebug } from './camera-debug-context';

export function CameraDebugPanel() {
  const { state, setBestRangeOverride, setBestElevationOverride } = useCameraDebug();
  
  const [rangeInput, setRangeInput] = useState('');
  const [elevationInput, setElevationInput] = useState('');
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [elevationEnabled, setElevationEnabled] = useState(false);

  const handleRangeEnabledChange = (enabled: boolean) => {
    setRangeEnabled(enabled);
    if (!enabled) {
      setBestRangeOverride(null);
      setRangeInput('');
    }
  };

  const handleElevationEnabledChange = (enabled: boolean) => {
    setElevationEnabled(enabled);
    if (!enabled) {
      setBestElevationOverride(null);
      setElevationInput('');
    }
  };

  const handleRangeChange = (value: string) => {
    setRangeInput(value);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setBestRangeOverride(num);
    } else {
      setBestRangeOverride(null);
    }
  };

  const handleElevationChange = (value: string) => {
    setElevationInput(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setBestElevationOverride(num);
    } else {
      setBestElevationOverride(null);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: '60px',
      right: '10px',
      width: '280px',
      background: 'rgba(0, 0, 0, 0.85)',
      color: 'white',
      padding: '15px',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'monospace',
      zIndex: 1000,
      border: '1px solid rgba(255, 255, 255, 0.2)',
    }}>
      <h3 style={{ 
        margin: '0 0 15px 0', 
        fontSize: '14px', 
        borderBottom: '1px solid rgba(255, 255, 255, 0.3)',
        paddingBottom: '8px',
        color: '#4CAF50'
      }}>
        Camera Debug
      </h3>

      {/* bestRange */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <input
            type="checkbox"
            checked={rangeEnabled}
            onChange={(e) => handleRangeEnabledChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ color: rangeEnabled ? '#4CAF50' : '#888' }}>
            Override bestRange
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={rangeInput}
            onChange={(e) => handleRangeChange(e.target.value)}
            disabled={!rangeEnabled}
            placeholder="3.0"
            step="0.1"
            min="0.1"
            max="20"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: rangeEnabled ? '#222' : '#111',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
          <span style={{ color: '#888', minWidth: '40px' }}>meters</span>
        </div>
        {state.bestRangeOverride !== null && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#4CAF50' }}>
            Active: {state.bestRangeOverride.toFixed(1)}m
          </div>
        )}
      </div>

      {/* bestElevation */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <input
            type="checkbox"
            checked={elevationEnabled}
            onChange={(e) => handleElevationEnabledChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ color: elevationEnabled ? '#4CAF50' : '#888' }}>
            Override bestElevation
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={elevationInput}
            onChange={(e) => handleElevationChange(e.target.value)}
            disabled={!elevationEnabled}
            placeholder="30"
            step="5"
            min="-90"
            max="90"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: elevationEnabled ? '#222' : '#111',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
          <span style={{ color: '#888', minWidth: '40px' }}>degrees</span>
        </div>
        {state.bestElevationOverride !== null && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#4CAF50' }}>
            Active: {state.bestElevationOverride.toFixed(0)}°
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{
        marginTop: '15px',
        paddingTop: '10px',
        borderTop: '1px solid rgba(255, 255, 255, 0.2)',
        fontSize: '11px',
        color: '#888'
      }}>
        <div>• Range: distance from player</div>
        <div>• Elevation: vertical angle</div>
        <div style={{ marginTop: '5px', color: '#666' }}>
          Unchecked = use camera.dat values
        </div>
      </div>
    </div>
  );
}

