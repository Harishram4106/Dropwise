import type { CSSProperties } from "react";
import { box, createIso, delay, pathOf, planeMatrix, type Box, type Iso } from "@/lib/iso";

const LINE = "#8a8fa6";
const TOP = "#f8f9fd";
const RIGHT = "#e4e7f1";
const LEFT = "#eef0f7";
const BLUE = "#4b63ff";
const HALO = "#cfd8ff";

const stroke = {
  stroke: LINE,
  strokeWidth: 0.9,
  strokeLinejoin: "round" as const,
  vectorEffect: "non-scaling-stroke" as const,
};

function Faces({ b, at }: { b: Box; at: number }) {
  return (
    <g>
      <polygon className="ln" pathLength={1} points={b.left} fill={LEFT} {...stroke} style={delay(at)} />
      <polygon className="ln" pathLength={1} points={b.right} fill={RIGHT} {...stroke} style={delay(at + 0.06)} />
      <polygon className="ln" pathLength={1} points={b.top} fill={TOP} {...stroke} style={delay(at + 0.12)} />
    </g>
  );
}

function DotGrid({
  iso,
  z,
  n,
  gap,
  r = 0.9,
  fill = LINE,
  cx = 0,
  cy = 0,
}: {
  iso: Iso;
  z: number;
  n: number;
  gap: number;
  r?: number;
  fill?: string;
  cx?: number;
  cy?: number;
}) {
  const off = ((n - 1) * gap) / 2;
  const dots = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) dots.push(<circle key={`${i}-${j}`} cx={cx - off + i * gap} cy={cy - off + j * gap} r={r} fill={fill} />);
  return <g transform={planeMatrix(iso, z)}>{dots}</g>;
}

function FloorCross({ iso, half, reach, z = 0, at = 0 }: { iso: Iso; half: number; reach: number; z?: number; at?: number }) {
  const lines: [number, number, number, number][] = [
    [-reach, -half, reach, -half],
    [-reach, half, reach, half],
    [-half, -reach, -half, reach],
    [half, -reach, half, reach],
  ];
  return (
    <g>
      {lines.map(([x1, y1, x2, y2], i) => (
        <path
          key={i}
          className="ln"
          pathLength={1}
          d={pathOf([iso(x1, y1, z), iso(x2, y2, z)])}
          fill="none"
          stroke="#cfd2df"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
          style={delay(at + i * 0.05)}
        />
      ))}
    </g>
  );
}

function Dashed({ iso, x, y, z1, z2, at = 1 }: { iso: Iso; x: number; y: number; z1: number; z2: number; at?: number }) {
  return (
    <path
      className="fd"
      d={pathOf([iso(x, y, z1), iso(x, y, z2)])}
      stroke="#a9adbf"
      strokeWidth={0.8}
      strokeDasharray="2 3"
      vectorEffect="non-scaling-stroke"
      style={delay(at)}
    />
  );
}

function EdgeDots({ iso, x, ys, z }: { iso: Iso; x: number; ys: number[]; z: number }) {
  return (
    <g className="fd" style={delay(1.1)}>
      {ys.map((y) => {
        const [cx, cy] = iso(x, y, z);
        return <circle key={y} cx={cx} cy={cy} r={0.95} fill={BLUE} />;
      })}
    </g>
  );
}

const svgProps = {
  viewBox: "0 0 260 240",
  className: "h-auto w-full max-w-[250px] overflow-visible",
  "aria-hidden": true,
};

/** 01 — stacked plates: every layer of a request gets accounted for. */
export function StackIllustration() {
  const iso = createIso(130, 152);
  const plates = [0, 1, 2, 3, 4].map((i) => box(iso, -55, -55, i * 20, 110, 110, 7));
  const topZ = 4 * 20 + 7;
  return (
    <svg {...svgProps}>
      <FloorCross iso={iso} half={84} reach={112} z={-8} />
      <Dashed iso={iso} x={-55} y={55} z1={-8} z2={topZ} at={0.9} />
      <Dashed iso={iso} x={55} y={-55} z1={-8} z2={topZ} at={0.9} />
      {plates.map((b, i) => (
        <g key={i} className="plate" style={{ "--i": i } as CSSProperties}>
          <Faces b={b} at={0.1 + i * 0.14} />
          <EdgeDots iso={iso} x={55} ys={[24, 31, 38, 45]} z={i * 20 + 3.5} />
          {i === plates.length - 1 && (
            <g className="fd" style={delay(1.2)}>
              <g transform={planeMatrix(iso, topZ)}>
                <circle r={30} fill={HALO} opacity={0.85} />
              </g>
              <DotGrid iso={iso} z={topZ} n={7} gap={5} r={0.95} fill={BLUE} />
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

/** 02 — routing: easy prompts hop to right-sized models. */
export function RouteIllustration() {
  const iso = createIso(130, 150);
  const S = 44;
  const H = 12;
  const A = box(iso, -80, -70, 50, S, S, H);
  const B = box(iso, 10, -50, 35, S, S, H);
  const C = box(iso, -70, 10, 0, S, S, H);
  const D = box(iso, 0, 35, -15, S, S, H);
  const route = pathOf([
    iso(-58, -48, 62),
    iso(32, -48, 62),
    iso(32, -28, 62),
    iso(32, -28, 47),
    iso(32, 57, 47),
    iso(32, 57, -3),
  ]);
  const shadow = pathOf([iso(-70, 10, -15), iso(-26, 10, -15), iso(-26, 54, -15), iso(-70, 54, -15)], true);
  return (
    <svg {...svgProps}>
      <FloorCross iso={iso} half={78} reach={110} z={-15} />
      <path d={shadow} fill="#d8dbe7" className="fd" style={delay(0.8)} />
      <Dashed iso={iso} x={-80} y={-26} z1={-15} z2={50} at={0.8} />
      <Dashed iso={iso} x={-36} y={-70} z1={-15} z2={50} at={0.8} />
      <Dashed iso={iso} x={54} y={-50} z1={-15} z2={35} at={0.8} />
      <Faces b={A} at={0.1} />
      <Faces b={C} at={0.25} />
      <Faces b={B} at={0.4} />
      <Faces b={D} at={0.55} />
      <DotGrid iso={iso} z={62} n={4} gap={5} cx={-58} cy={-48} />
      <DotGrid iso={iso} z={47} n={4} gap={5} cx={32} cy={-28} />
      <g className="fd" style={delay(1)}>
        <g transform={planeMatrix(iso, -3)}>
          <circle cx={22} cy={57} r={13} fill={HALO} />
          <circle cx={22} cy={57} r={5} fill="none" stroke={BLUE} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
        </g>
        <path d={route} fill="none" stroke={BLUE} strokeOpacity={0.35} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
        <path d={route} fill="none" stroke={BLUE} strokeWidth={1.4} pathLength={1} className="route-flow" vectorEffect="non-scaling-stroke" />
        {[iso(-58, -48, 62), iso(32, -28, 47)].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={1.8} fill={BLUE} />
        ))}
      </g>
    </svg>
  );
}

/** 03 — caching: many incoming calls collapse into one answer. */
export function CacheIllustration() {
  const iso = createIso(130, 172);
  const big = box(iso, -55, -55, 0, 110, 110, 55);
  const cubes: { i: number; j: number }[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cubes.push({ i, j });
  cubes.sort((a, b) => a.i + a.j - (b.i + b.j));
  return (
    <svg {...svgProps}>
      <FloorCross iso={iso} half={74} reach={104} />
      <Faces b={big} at={0.1} />
      <EdgeDots iso={iso} x={55} ys={[30, 36, 42]} z={6} />
      <g className="fd" style={delay(1)}>
        <g transform={planeMatrix(iso, 55)}>
          <circle r={28} fill={HALO} />
        </g>
        {(() => {
          const [cx, cy] = iso(0, 0, 55);
          return <circle cx={cx} cy={cy} r={2.2} fill={BLUE} className="pulse" />;
        })()}
      </g>
      {cubes.map(({ i, j }) => {
        const b = box(iso, -44 + i * 24, -44 + j * 24, 118, 12, 12, 7);
        return (
          <g key={`${i}-${j}`} className="cube" style={{ "--f": `${(i + j) * 0.18}s` } as CSSProperties}>
            <Faces b={b} at={0.45 + (i + j) * 0.06} />
          </g>
        );
      })}
    </svg>
  );
}

/** 04 — registry: every factor orbits back to a fresh, cited source. */
export function RegistryIllustration() {
  const iso = createIso(130, 162);
  const base = box(iso, -65, -65, 0, 130, 130, 16);
  const mid = box(iso, -28, -28, 55, 56, 56, 10);
  const top = box(iso, -28, -28, 110, 56, 56, 10);
  const [, oy] = iso(0, 0, 42);
  const orbit = `M 8 ${oy} A 122 50 0 1 0 252 ${oy} A 122 50 0 1 0 8 ${oy}`;
  return (
    <svg {...svgProps}>
      <path className="fd" d={orbit} fill="none" stroke="#c3c7d6" strokeWidth={0.9} vectorEffect="non-scaling-stroke" style={delay(1)} />
      <Faces b={base} at={0.1} />
      <DotGrid iso={iso} z={16} n={9} gap={9} r={0.8} />
      <EdgeDots iso={iso} x={65} ys={[40, 46, 52]} z={8} />
      <Dashed iso={iso} x={-28} y={28} z1={16} z2={55} at={0.7} />
      <Dashed iso={iso} x={28} y={-28} z1={16} z2={55} at={0.7} />
      <g className="lift" style={{ "--i": 1 } as CSSProperties}>
        <Faces b={mid} at={0.35} />
        <DotGrid iso={iso} z={65} n={5} gap={5} fill={BLUE} />
      </g>
      <g className="lift" style={{ "--i": 2 } as CSSProperties}>
        <Dashed iso={iso} x={-28} y={28} z1={65} z2={110} at={0.9} />
        <Dashed iso={iso} x={28} y={-28} z1={65} z2={110} at={0.9} />
        <Faces b={top} at={0.6} />
        <DotGrid iso={iso} z={120} n={5} gap={5} fill={BLUE} />
      </g>
      <g className="fd" style={delay(1.3)}>
        <circle r={3} fill={BLUE}>
          <animateMotion dur="9s" repeatCount="indefinite" path={orbit} />
        </circle>
        <circle r={2.4} fill="#8ea2ff">
          <animateMotion dur="9s" begin="-4.5s" repeatCount="indefinite" path={orbit} />
        </circle>
      </g>
    </svg>
  );
}
