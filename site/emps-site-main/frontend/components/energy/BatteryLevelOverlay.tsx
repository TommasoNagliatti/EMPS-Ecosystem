import { useId, type CSSProperties } from "react";

export type BatteryVisualState =
  | "charging"
  | "discharging"
  | "idle"
  | "critical"
  | "unknown";

const BAR_COUNT = 8;

// Inner display corners measured on emps-energy-station-v2.jpg (1600 x 900).
const DISPLAY = {
  topLeft: [1365.5, 534.5],
  topRight: [1395.5, 526.5],
  bottomRight: [1395, 635.5],
  bottomLeft: [1365.8, 645],
} as const;

function displayPoint(u: number, v: number) {
  const left = DISPLAY.topLeft.map(
    (value, axis) => value + (DISPLAY.bottomLeft[axis] - value) * v,
  );
  const right = DISPLAY.topRight.map(
    (value, axis) => value + (DISPLAY.bottomRight[axis] - value) * v,
  );

  return left.map((value, axis) => (value + (right[axis] - value) * u).toFixed(3)).join(",");
}

function displayQuad(left: number, top: number, right: number, bottom: number) {
  return [
    displayPoint(left, top),
    displayPoint(right, top),
    displayPoint(right, bottom),
    displayPoint(left, bottom),
  ].join(" ");
}

const SCREEN_POINTS = displayQuad(0, 0, 1, 1);
const BARS = Array.from({ length: BAR_COUNT }, (_, index) => {
  const bottom = 0.95 - index * 0.105;
  const top = bottom - 0.079;

  return {
    face: displayQuad(0.09, top, 0.91, bottom),
    highlight: displayQuad(0.09, top, 0.91, top + 0.007),
    shade: displayQuad(0.09, bottom - 0.009, 0.91, bottom),
  };
});

export function BatteryLevelOverlay({
  percent,
  state,
}: {
  percent: number | null;
  state: BatteryVisualState;
}) {
  const id = useId();
  const level = percent === null || !Number.isFinite(percent)
    ? null
    : Math.min(100, Math.max(0, percent));
  const filledBars = level === null || level === 0
    ? 0
    : Math.max(1, Math.round((level / 100) * BAR_COUNT));
  const description = level === null
    ? "Nivel da bateria indisponivel"
    : `Bateria em ${Math.round(level)} por cento`;

  return (
    <svg
      aria-label={description}
      className={`energy-battery-device energy-battery-device--${state}`}
      preserveAspectRatio="none"
      role="img"
      style={{
        "--battery-bar-count": filledBars,
        "--battery-animation-steps": Math.max(1, filledBars),
      } as CSSProperties}
      viewBox="0 0 1600 900"
    >
      <title>{description}</title>
      <defs>
        <clipPath id={`${id}-display`}>
          <polygon points={SCREEN_POINTS} />
        </clipPath>
        <linearGradient id={`${id}-screen`}>
          <stop offset="0" stopColor="#0a141b" />
          <stop offset="0.22" stopColor="#253640" />
          <stop offset="1" stopColor="#101e26" />
        </linearGradient>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="energy-battery-device__light-start" />
          <stop offset="0.38" className="energy-battery-device__light-mid" />
          <stop offset="1" className="energy-battery-device__light-end" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-display)`}>
        <polygon points={SCREEN_POINTS} fill={`url(#${id}-screen)`} />
        <polygon
          points={displayQuad(0, 0, 0.06, 1)}
          fill="#02080b"
          opacity="0.7"
        />
        <polygon
          points={displayQuad(0, 0, 1, 0.018)}
          fill="#02080b"
          opacity="0.7"
        />
        <polygon
          className="energy-battery-device__status"
          points={displayQuad(0.22, 0.045, 0.78, 0.057)}
          fill={level === null ? "#42515a" : `url(#${id}-light)`}
        />
        {BARS.map((bar, index) => (
          <g
            className={`energy-battery-device__segment${index < filledBars ? " is-filled" : ""}`}
            key={index}
            style={{ "--bar-index": index } as CSSProperties}
          >
            <polygon points={bar.face} fill="#34434c" />
            <polygon points={bar.highlight} fill="#6f7e87" opacity="0.38" />
            {index < filledBars && (
              <g className="energy-battery-device__light">
                <polygon points={bar.face} fill={`url(#${id}-light)`} />
                <polygon points={bar.highlight} fill="#c4f4f8" opacity="0.38" />
              </g>
            )}
            <polygon points={bar.shade} fill="#041219" opacity="0.4" />
          </g>
        ))}
      </g>
    </svg>
  );
}
