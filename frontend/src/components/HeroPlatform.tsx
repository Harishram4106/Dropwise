import type { CSSProperties } from "react";
import { box, createIso, delay, pathOf, planeMatrix, square } from "@/lib/iso";

const iso = createIso(400, 410);
const S = 150; // half-width of the glowing platform
const SLAB_H = 44;
const TOP = SLAB_H;
const FRAME_Z = 236;
const F = 132; // half-width of the floating wireframe

const slab = box(iso, -S, -S, 0, S * 2, S * 2, SLAB_H);

// Long floor lines that run past the platform, like a blueprint grid.
const floorLines: [number, number, number, number][] = [
  [-560, -280, 560, -280],
  [-560, 280, 560, 280],
  [-280, -560, -280, 560],
  [280, -560, 280, 560],
  [-560, -200, 560, -200],
  [200, -560, 200, 560],
];

const stroke = { vectorEffect: "non-scaling-stroke" as const };

/** Each layer drifts by a different amount as the cursor moves (--mx / --my set by the hero). */
const parallax = (x: number, y: number) =>
  ({ transform: `translate(calc(var(--mx, 0) * ${x}px), calc(var(--my, 0) * ${y}px))` }) as CSSProperties;

function PlaneLabel({ x, y, text, w }: { x: number; y: number; text: string; w: number }) {
  return (
    <g>
      <rect x={x} y={y - 9} width={w} height={18} rx={2} fill="rgba(140,170,255,0.18)" stroke="rgba(190,210,255,0.55)" strokeWidth={0.8} {...stroke} />
      <text x={x + 8} y={y + 3.6} fontSize={10} letterSpacing={1.2} fill="rgba(235,242,255,0.85)" className="font-mono">
        {text}
      </text>
    </g>
  );
}

export default function HeroPlatform({ pulse = 0 }: { pulse?: number }) {
  const curve = "M -118 46 C -84 -70, -52 86, -16 -6 S 40 -104, 70 -18 S 104 70, 120 6";
  const frameCorners: [number, number][] = [
    [-F, -F],
    [F, -F],
    [F, F],
    [-F, F],
  ];

  return (
    <svg viewBox="0 -20 800 740" className="hp-svg h-auto w-full" role="img" aria-label="An isometric water-footprint platform with a floating range chart">
      <defs>
        <linearGradient id="hp-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9db4ff" />
          <stop offset="0.45" stopColor="#5d7bff" />
          <stop offset="1" stopColor="#3550fb" />
        </linearGradient>
        <linearGradient id="hp-right" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4864ff" />
          <stop offset="1" stopColor="#2337e2" />
        </linearGradient>
        <linearGradient id="hp-left" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7d99ff" />
          <stop offset="1" stopColor="#4c69ff" />
        </linearGradient>
        <filter id="hp-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="38" />
        </filter>
      </defs>

      <g className="px-layer" style={parallax(-8, -5)}>
        {/* Floor grid */}
        <g stroke="rgba(200,215,255,0.32)" strokeWidth={1} fill="none">
          {floorLines.map(([x1, y1, x2, y2], i) => (
            <path key={i} d={pathOf([iso(x1, y1), iso(x2, y2)])} pathLength={1} className="hp-draw" style={delay(0.1 + i * 0.08)} {...stroke} />
          ))}
          <polygon points={square(iso, 200)} pathLength={1} className="hp-draw" style={delay(0.3)} stroke="rgba(210,224,255,0.45)" {...stroke} />
        </g>

        {/* Floor labels */}
        <g transform={planeMatrix(iso, 0)} className="hp-fade" style={delay(1.4)}>
          <PlaneLabel x={60} y={-280} text="CACHE HITS" w={96} />
          <PlaneLabel x={-110} y={280} text="ROUTING" w={74} />
          <PlaneLabel x={290} y={-60} text="BUDGETS" w={76} />
        </g>

        {/* Travelling signal on the floor */}
        <circle r={3.2} fill="#fff" className="hp-fade" style={delay(2.2)}>
          <animateMotion dur="7s" repeatCount="indefinite" path={pathOf([iso(-560, 200), iso(560, 200)])} />
        </circle>
        <circle r={3.2} fill="#fff" className="hp-fade" style={delay(2.6)}>
          <animateMotion dur="9s" repeatCount="indefinite" path={pathOf([iso(280, 560), iso(280, -560)])} />
        </circle>
      </g>

      {/* Platform slab */}
      <g className="px-layer" style={parallax(10, 6)}>
        <g className="hp-slab">
          <ellipse cx={400} cy={430} rx={300} ry={150} fill="#3d5cff" opacity={0.75} filter="url(#hp-blur)" />
          <polygon points={square(iso, 178, 0)} fill="rgba(40,60,240,0.35)" />
          <polygon points={slab.left} fill="url(#hp-left)" />
          <polygon points={slab.right} fill="url(#hp-right)" />
          <polygon points={slab.top} fill="url(#hp-top)" />
          <path
            d={pathOf([iso(-S, S, TOP), iso(S, S, TOP), iso(S, -S, TOP)])}
            fill="none"
            stroke="rgba(230,238,255,0.75)"
            strokeWidth={1.2}
            {...stroke}
          />
          <g transform={planeMatrix(iso, TOP)}>
            <rect x={-120} y={-120} width={240} height={240} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={1} {...stroke} />
            <path d={curve} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.3} {...stroke} />
            <path d={curve} fill="none" stroke="#fff" strokeWidth={1.6} pathLength={1} className="hp-trace" {...stroke} />
            <PlaneLabel x={-118} y={104} text="WATER RECEIPTS" w={124} />
            {/* Splash rings on the platform each time the hero is clicked */}
            {pulse > 0 &&
              [0, 0.18, 0.36].map((d) => (
                <circle
                  key={`${pulse}-${d}`}
                  r={120}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={1.4}
                  {...stroke}
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animation: `plat-ripple 1.4s cubic-bezier(.2,.7,.3,1) ${d}s both`,
                  }}
                />
              ))}
          </g>
          {[
            [-120, -120],
            [120, -120],
            [120, 120],
            [-120, 120],
          ].map(([x, y], i) => {
            const [cx, cy] = iso(x, y, TOP);
            return <circle key={i} cx={cx} cy={cy} r={2.6} fill="#fff" />;
          })}
        </g>
      </g>

      {/* Floating wireframe: the estimated range */}
      <g className="px-layer" style={parallax(24, 15)}>
        <g className="hp-frame">
          <g className="hp-float">
            {frameCorners.map(([x, y], i) => (
              <path
                key={i}
                d={pathOf([iso(x, y, FRAME_Z), iso(x, y, TOP)])}
                stroke="rgba(255,255,255,0.45)"
                strokeDasharray="3 4"
                strokeWidth={1}
                {...stroke}
              />
            ))}
            <polygon points={square(iso, F, FRAME_Z)} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.9)" strokeWidth={1.1} {...stroke} />
            <g transform={planeMatrix(iso, FRAME_Z)}>
              <text x={2} y={-112} fontSize={11} letterSpacing={1.4} fill="rgba(255,255,255,0.9)" className="font-mono">
                FOOTPRINT RANGE
              </text>
              <text x={-118} y={-58} fontSize={9} fill="rgba(255,255,255,0.6)">
                low–high mL per request
              </text>
              <rect x={-60} y={-14} width={128} height={28} fill="none" stroke="rgba(255,255,255,0.35)" strokeDasharray="2 3" {...stroke} />
              <rect x={-24} y={-14} width={58} height={28} fill="rgba(255,255,255,0.18)" className="range-breathe" />
            </g>
            {(() => {
              const [cx, cy] = iso(0, 0, FRAME_Z);
              return <circle cx={cx} cy={cy} r={2.6} fill="#fff" className="blink" />;
            })()}
          </g>
        </g>
      </g>
    </svg>
  );
}
