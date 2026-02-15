import { useMemo, useState } from "react";
import { setWorldTime, useWorldTime } from "./world-time";

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.trunc(value)));

export function WorldTimeOverlay({ onClose }: { onClose?: () => void } = {}) {
  const t = useWorldTime();
  const [open, setOpen] = useState(false);
  const [dayInput, setDayInput] = useState(String(t.day));
  const [hourInput, setHourInput] = useState(String(t.hour));
  const [minuteInput, setMinuteInput] = useState(String(t.minute));

  const display = useMemo(() => {
    const hh = String(t.hour).padStart(2, "0");
    const mm = String(t.minute).padStart(2, "0");
    return `Day ${t.day} ${hh}:${mm}`;
  }, [t.day, t.hour, t.minute]);

  const openEditor = () => {
    setDayInput(String(t.day));
    setHourInput(String(t.hour));
    setMinuteInput(String(t.minute));
    setOpen(true);
  };

  const apply = () => {
    const day = Number(dayInput);
    const hour = Number(hourInput);
    const minute = Number(minuteInput);
    if (!Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(minute)) return;
    setWorldTime(clampInt(day, 0, 9999), clampInt(hour, 0, 23), clampInt(minute, 0, 59));
    setOpen(false);
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 10,
        bottom: 10,
        zIndex: 1500,
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
        <button
          type="button"
          data-testid="world-time-display"
          onClick={() => (open ? setOpen(false) : openEditor())}
          style={{
            cursor: "pointer",
            background: "rgba(0, 0, 0, 0.65)",
            color: "white",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.25)",
          }}
        >
          {display}
        </button>
        {onClose && (
          <button
            type="button"
            data-testid="world-time-close"
            aria-label="Close"
            onClick={() => onClose()}
            style={{
              cursor: "pointer",
              background: "rgba(0, 0, 0, 0.65)",
              color: "white",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.25)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          style={{
            marginTop: 8,
            background: "rgba(0, 0, 0, 0.8)",
            color: "white",
            padding: "10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.25)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>Day</span>
            <input
              data-testid="world-time-day"
              value={dayInput}
              onChange={(e) => setDayInput(e.target.value)}
              style={{ width: 70 }}
            />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>Hour</span>
            <input
              data-testid="world-time-hour"
              value={hourInput}
              onChange={(e) => setHourInput(e.target.value)}
              style={{ width: 50 }}
            />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>Min</span>
            <input
              data-testid="world-time-minute"
              value={minuteInput}
              onChange={(e) => setMinuteInput(e.target.value)}
              style={{ width: 50 }}
            />
          </label>
          <button type="button" data-testid="world-time-apply" onClick={apply}>
            Apply
          </button>
          <button type="button" data-testid="world-time-cancel" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
