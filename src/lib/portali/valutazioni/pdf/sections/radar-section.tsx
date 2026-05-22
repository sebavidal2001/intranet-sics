import { Svg, Polygon, Line, Circle, G, Text as SvgText } from "@react-pdf/renderer";
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
  const WIDTH = 340;
  const HEIGHT = 220;
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const R = 68;
  const LABEL_R = 98;
  const LABEL_MARGIN = 14;
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
  const labelAnchor = (x: number) => {
    if (Math.abs(x - cx) < 4) return "middle";
    return x > cx ? "start" : "end";
  };
  const labelX = (x: number) => Math.min(Math.max(x, LABEL_MARGIN), WIDTH - LABEL_MARGIN);
  const labelLines = (text: string): string[] => {
    if (text.length <= 18) return [text];

    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= 18) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
      if (lines.length === 1 && current.length > 18) break;
    }

    if (current) lines.push(current);
    return lines.slice(0, 2);
  };

  return (
    <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {[0.25, 0.5, 0.75, 1.0].map((lvl, i) => (
        <Polygon key={`g${i}`} points={gridPts(lvl)} fill="none" stroke="#e2e8f0" strokeWidth={lvl === 1.0 ? 0.8 : 0.4} />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const a = ang(i);
        return <Line key={`ax${i}`} x1={cx} y1={cy} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} stroke="#cbd5e1" strokeWidth={0.4} />;
      })}
      {[0, Math.round(scalaMax / 2), scalaMax].map((tick, i) => {
        const y = cy - (R * tick) / scalaMax;
        return (
          <SvgText
            key={`tick${i}`}
            x={cx + 4}
            y={y + 3}
            style={{ fontSize: 6, fill: "#94a3b8" }}
          >
            {tick}
          </SvgText>
        );
      })}
      {data.map((d, i) => {
        const a = ang(i);
        const rawX = cx + LABEL_R * Math.cos(a);
        const x = labelX(rawX);
        const y = cy + LABEL_R * Math.sin(a);
        const lines = labelLines(d.parametro);
        const lineHeight = 8;
        const yOffset = lines.length > 1 ? -2 : 3;
        return lines.map((line, lineIndex) => (
          <SvgText
            key={`label${i}-${lineIndex}`}
            x={x}
            y={y + yOffset + lineIndex * lineHeight}
            textAnchor={labelAnchor(x)}
            style={{ fontSize: 7, fill: "#1f2937" }}
          >
            {line}
          </SvgText>
        ));
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
