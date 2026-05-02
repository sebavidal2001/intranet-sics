export default function SuperadminLoading() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-8 w-48 bg-border rounded-lg" />
        <div className="h-4 w-64 bg-border rounded" />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-bg p-6 space-y-3">
            <div className="h-3 w-24 bg-border rounded" />
            <div className="h-10 w-12 bg-border rounded" />
          </div>
        ))}
      </div>

      {/* Sezioni */}
      {[...Array(2)].map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-bg divide-y divide-border overflow-hidden">
          <div className="px-6 py-4">
            <div className="h-5 w-36 bg-border rounded" />
          </div>
          {[...Array(3)].map((_, j) => (
            <div key={j} className="px-6 py-4 flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-40 bg-border rounded" />
                <div className="h-3 w-28 bg-border rounded" />
              </div>
              <div className="h-8 w-20 bg-border rounded-lg" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
