import { Svg, Polygon, Line, Circle, G } from "@react-pdf/renderer";
import type { RadarPoint } from "../certificato";

export function RadarChartSvg({
  data,
  scalaMax,
  primary,
}: {
  data: RadarPoint[];
  scalaMax: number;
  primary: string;
}) {
  const SIZE = 200;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = 72;
  const n = data.length;
  if (n < 3) return null;

  const ang = (i: number) => (2 * Math.PI / n) * i - Math.PI / 2;
  const ptCoords = (i: number, val: number): [number, number] => {
    const a = ang(i);
    const norm = Math.min(Math.max(val / scalaMax, 0), 1);
    return [cx + R * norm * Math.cos(a), cy + R * norm * Math.sin(a)];
  };
  const gridPts = (level: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = ang(i);
      return `${(cx + R * level * Math.cos(a)).toFixed(2)},${(cy + R * level * Math.sin(a)).toFixed(2)}`;
    }).join(" ");
  const polyPts = (vals: number[]) =>
    vals.map((v, i) => {
      const [x, y] = ptCoords(i, v);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");

  return (
    <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {[0.25, 0.5, 0.75, 1.0].map((lvl, i) => (
        <Polygon key={`g${i}`} points={gridPts(lvl)} fill="none" stroke="#e2e8f0" strokeWidth={lvl === 1.0 ? 0.8 : 0.4} />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const a = ang(i);
        return <Line key={`ax${i}`} x1={cx} y1={cy} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} stroke="#cbd5e1" strokeWidth={0.4} />;
      })}
      <Polygon points={polyPts(data.map((d) => d.autovalutazione))} fill={primary} fillOpacity={0.15} stroke={primary} strokeWidth={1.2} />
      <Polygon points={polyPts(data.map((d) => d.responsabile))} fill="#f59e0b" fillOpacity={0.15} stroke="#f59e0b" strokeWidth={1.2} />
      {data.map((_, i) => {
        const [ax, ay] = ptCoords(i, data[i].autovalutazione);
        const [rx, ry] = ptCoords(i, data[i].responsabile);
        return (
          <G key={`dot${i}`}>
            <Circle cx={ax} cy={ay} r={2.5} fill={primary} />
            <Circle cx={rx} cy={ry} r={2.5} fill="#f59e0b" />
          </G>
        );
      })}
      <Circle cx={cx} cy={cy} r={1.5} fill="#94a3b8" />
    </Svg>
  );
}
