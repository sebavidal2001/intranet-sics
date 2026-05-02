export default function IntranetLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-8 w-56 bg-border rounded-lg" />
        <div className="h-4 w-80 bg-border rounded" />
      </div>
      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-bg p-6 space-y-3">
            <div className="h-4 w-24 bg-border rounded" />
            <div className="h-8 w-16 bg-border rounded" />
            <div className="h-3 w-32 bg-border rounded" />
          </div>
        ))}
      </div>
      {/* Content block */}
      <div className="rounded-xl border border-border bg-bg p-6 space-y-4">
        <div className="h-5 w-40 bg-border rounded" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-0">
            <div className="space-y-1.5">
              <div className="h-4 w-48 bg-border rounded" />
              <div className="h-3 w-32 bg-border rounded" />
            </div>
            <div className="h-8 w-24 bg-border rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
