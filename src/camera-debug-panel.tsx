import { useEffect, useMemo, useState } from 'react';
import { useCameraDebug } from './camera-debug-context';
import { getCameraMode } from './camera-daedalus';

export function CameraDebugPanel() {
  const {
    state,
    setBestRangeOverride,
    setBestElevationOverride,
    setBestAzimuthOverride,
    setRotOffsetXOverride,
    setRotOffsetYOverride,
    setVeloTransOverride
  } = useCameraDebug();
  
  const [rangeInput, setRangeInput] = useState('');
  const [elevationInput, setElevationInput] = useState('');
  const [azimuthInput, setAzimuthInput] = useState('');
  const [rotOffsetXInput, setRotOffsetXInput] = useState('');
  const [rotOffsetYInput, setRotOffsetYInput] = useState('');
  const [veloTransInput, setVeloTransInput] = useState('');
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [elevationEnabled, setElevationEnabled] = useState(false);
  const [azimuthEnabled, setAzimuthEnabled] = useState(false);
  const [rotOffsetXEnabled, setRotOffsetXEnabled] = useState(false);
  const [rotOffsetYEnabled, setRotOffsetYEnabled] = useState(false);
  const [veloTransEnabled, setVeloTransEnabled] = useState(false);

  const activeModeName = "CAMMODNORMAL";
  const camDef = getCameraMode(activeModeName);
  const effectiveRange = useMemo(() => {
    const minRange = Number.isFinite(camDef?.minRange) ? camDef!.minRange : 2;
    const maxRange = Number.isFinite(camDef?.maxRange) ? camDef!.maxRange : 10;
    return {
      min: Math.min(minRange, maxRange),
      max: Math.max(minRange, maxRange),
      source: camDef ? "camera.dat" : "fallback"
    };
  }, [camDef]);
  const effectiveElevation = useMemo(() => {
    const minElevation = Number.isFinite(camDef?.minElevation) ? camDef!.minElevation : 0;
    const maxElevation = Number.isFinite(camDef?.maxElevation) ? camDef!.maxElevation : 90;
    return {
      min: Math.min(minElevation, maxElevation),
      max: Math.max(minElevation, maxElevation),
      source: camDef ? "camera.dat" : "fallback"
    };
  }, [camDef]);

  const clampElevation = (value: number) => {
    return Math.max(effectiveElevation.min, Math.min(effectiveElevation.max, value));
  };

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

  const handleAzimuthEnabledChange = (enabled: boolean) => {
    setAzimuthEnabled(enabled);
    if (!enabled) {
      setBestAzimuthOverride(null);
      setAzimuthInput('');
    }
  };

  const handleRotOffsetXEnabledChange = (enabled: boolean) => {
    setRotOffsetXEnabled(enabled);
    if (!enabled) {
      setRotOffsetXOverride(null);
      setRotOffsetXInput('');
    }
  };

  const handleRotOffsetYEnabledChange = (enabled: boolean) => {
    setRotOffsetYEnabled(enabled);
    if (!enabled) {
      setRotOffsetYOverride(null);
      setRotOffsetYInput('');
    }
  };

  const handleVeloTransEnabledChange = (enabled: boolean) => {
    setVeloTransEnabled(enabled);
    if (!enabled) {
      setVeloTransOverride(null);
      setVeloTransInput('');
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
      const clamped = clampElevation(num);
      setBestElevationOverride(clamped);
      if (clamped !== num) {
        setElevationInput(String(clamped));
      }
    } else {
      setBestElevationOverride(null);
    }
  };

  const handleAzimuthChange = (value: string) => {
    setAzimuthInput(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setBestAzimuthOverride(num);
    } else {
      setBestAzimuthOverride(null);
    }
  };

  const handleRotOffsetXChange = (value: string) => {
    setRotOffsetXInput(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setRotOffsetXOverride(num);
    } else {
      setRotOffsetXOverride(null);
    }
  };

  const handleRotOffsetYChange = (value: string) => {
    setRotOffsetYInput(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setRotOffsetYOverride(num);
    } else {
      setRotOffsetYOverride(null);
    }
  };

  const handleVeloTransChange = (value: string) => {
    setVeloTransInput(value);
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setVeloTransOverride(num);
    } else {
      setVeloTransOverride(null);
    }
  };

  useEffect(() => {
    if (!elevationEnabled || state.bestElevationOverride === null) return;
    const clamped = clampElevation(state.bestElevationOverride);
    if (clamped === state.bestElevationOverride) return;
    setBestElevationOverride(clamped);
    setElevationInput(String(clamped));
  }, [elevationEnabled, state.bestElevationOverride, setBestElevationOverride, effectiveElevation]);

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
      <div style={{ marginBottom: '15px' }}>
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
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#888' }}>
          Effective: {effectiveElevation.min.toFixed(0)}° - {effectiveElevation.max.toFixed(0)}°
        </div>
      </div>

      {/* bestAzimuth */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <input
            type="checkbox"
            checked={azimuthEnabled}
            onChange={(e) => handleAzimuthEnabledChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ color: azimuthEnabled ? '#4CAF50' : '#888' }}>
            Override bestAzimuth
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={azimuthInput}
            onChange={(e) => handleAzimuthChange(e.target.value)}
            disabled={!azimuthEnabled}
            placeholder="0"
            step="5"
            min="-180"
            max="180"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: azimuthEnabled ? '#222' : '#111',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
          <span style={{ color: '#888', minWidth: '40px' }}>degrees</span>
        </div>
        {state.bestAzimuthOverride !== null && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#4CAF50' }}>
            Active: {state.bestAzimuthOverride.toFixed(0)}°
          </div>
        )}
      </div>

      {/* rotOffsetX */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <input
            type="checkbox"
            checked={rotOffsetXEnabled}
            onChange={(e) => handleRotOffsetXEnabledChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ color: rotOffsetXEnabled ? '#4CAF50' : '#888' }}>
            Override rotOffsetX
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={rotOffsetXInput}
            onChange={(e) => handleRotOffsetXChange(e.target.value)}
            disabled={!rotOffsetXEnabled}
            placeholder="23"
            step="1"
            min="-90"
            max="90"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: rotOffsetXEnabled ? '#222' : '#111',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
          <span style={{ color: '#888', minWidth: '40px' }}>degrees</span>
        </div>
        {state.rotOffsetXOverride !== null && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#4CAF50' }}>
            Active: {state.rotOffsetXOverride.toFixed(0)}°
          </div>
        )}
      </div>

      {/* rotOffsetY */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <input
            type="checkbox"
            checked={rotOffsetYEnabled}
            onChange={(e) => handleRotOffsetYEnabledChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ color: rotOffsetYEnabled ? '#4CAF50' : '#888' }}>
            Override rotOffsetY
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={rotOffsetYInput}
            onChange={(e) => handleRotOffsetYChange(e.target.value)}
            disabled={!rotOffsetYEnabled}
            placeholder="0"
            step="1"
            min="-180"
            max="180"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: rotOffsetYEnabled ? '#222' : '#111',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
          <span style={{ color: '#888', minWidth: '40px' }}>degrees</span>
        </div>
        {state.rotOffsetYOverride !== null && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#4CAF50' }}>
            Active: {state.rotOffsetYOverride.toFixed(0)}°
          </div>
        )}
      </div>

      {/* veloTrans */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
          <input
            type="checkbox"
            checked={veloTransEnabled}
            onChange={(e) => handleVeloTransEnabledChange(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <span style={{ color: veloTransEnabled ? '#4CAF50' : '#888' }}>
            Override veloTrans
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            value={veloTransInput}
            onChange={(e) => handleVeloTransChange(e.target.value)}
            disabled={!veloTransEnabled}
            placeholder="0"
            step="0.1"
            min="0"
            max="100"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: veloTransEnabled ? '#222' : '#111',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
            }}
          />
          <span style={{ color: '#888', minWidth: '40px' }}>units</span>
        </div>
        {state.veloTransOverride !== null && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#4CAF50' }}>
            Active: {state.veloTransOverride.toFixed(1)}
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
        <div>
          • Mode: {activeModeName} ({effectiveElevation.source})
        </div>
        <div>
          • Range min/max: {effectiveRange.min.toFixed(1)} - {effectiveRange.max.toFixed(1)}m
        </div>
        <div>
          • Elevation min/max: {effectiveElevation.min.toFixed(0)}° - {effectiveElevation.max.toFixed(0)}°
        </div>
        <div>• Range: distance from player</div>
        <div>• Elevation: vertical angle</div>
        <div>• Azimuth: yaw offset</div>
        <div>• rotOffsetX: pitch offset</div>
        <div>• rotOffsetY: yaw offset</div>
        <div>• veloTrans: target smoothing speed</div>
        <div style={{ marginTop: '5px', color: '#666' }}>
          Unchecked = use camera.dat values
        </div>
      </div>
    </div>
  );
}
