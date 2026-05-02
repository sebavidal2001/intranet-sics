import { View, Text } from "@react-pdf/renderer";

export function BarraPunteggio({
  valore,
  max,
  primary,
}: {
  valore: number;
  max: number;
  primary: string;
}) {
  const pct = Math.min(Math.max(valore / max, 0), 1);
  return (
    <View>
      <View style={{ height: 7, backgroundColor: "#d1d5db", borderRadius: 3, overflow: "hidden" }}>
        <View style={{ height: 7, borderRadius: 3, backgroundColor: primary, width: `${pct * 100}%` }} />
      </View>
      <Text style={{ fontSize: 6.5, color: "#64748b", marginTop: 1 }}>
        {valore.toFixed(1)} / {max}
      </Text>
    </View>
  );
}
