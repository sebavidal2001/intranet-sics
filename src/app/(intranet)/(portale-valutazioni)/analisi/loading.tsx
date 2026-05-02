export default function AnalisiLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-9 w-52 bg-border rounded-lg" />
        <div className="h-4 w-80 bg-border rounded" />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-bg p-6 space-y-3">
            <div className="h-3 w-36 bg-border rounded" />
            <div className="h-10 w-16 bg-border rounded" />
            <div className="h-3 w-24 bg-border rounded" />
          </div>
        ))}
      </div>

      {/* Radar chart placeholder */}
      <div className="rounded-xl border border-border bg-bg p-6 space-y-4">
        <div className="h-5 w-44 bg-border rounded" />
        <div className="h-3 w-72 bg-border rounded" />
        <div className="flex items-center justify-center py-8">
          <div className="h-64 w-64 rounded-full bg-border opacity-40" />
        </div>
      </div>

      {/* Trend chart placeholder */}
      <div className="rounded-xl border border-border bg-bg p-6 space-y-4">
        <div className="h-5 w-36 bg-border rounded" />
        <div className="h-3 w-60 bg-border rounded" />
        <div className="h-48 w-full bg-border rounded-lg opacity-40" />
      </div>
    </div>
  );
}
