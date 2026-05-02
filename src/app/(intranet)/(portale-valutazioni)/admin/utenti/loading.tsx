export default function UtentiLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="h-3 w-20 bg-border rounded" />
        <div className="h-3 w-2 bg-border rounded" />
        <div className="h-3 w-28 bg-border rounded" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-9 w-52 bg-border rounded-lg" />
          <div className="h-4 w-32 bg-border rounded" />
        </div>
        <div className="flex gap-3">
          <div className="h-9 w-32 bg-border rounded-lg" />
          <div className="h-9 w-36 bg-border rounded-lg" />
        </div>
      </div>

      {/* Tabella */}
      <div className="rounded-xl border border-border bg-bg overflow-hidden">
        {/* Header tabella */}
        <div className="px-6 py-4 border-b border-border">
          <div className="h-5 w-32 bg-border rounded" />
        </div>
        {/* Righe */}
        <div className="divide-y divide-border">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-4">
              <div className="h-4 w-36 bg-border rounded shrink-0" />
              <div className="h-4 w-48 bg-border rounded shrink-0" />
              <div className="h-5 w-24 bg-border rounded-full shrink-0" />
              <div className="h-5 w-16 bg-border rounded-full shrink-0" />
              <div className="h-4 w-24 bg-border rounded shrink-0" />
              <div className="h-4 w-32 bg-border rounded shrink-0 ml-auto" />
              <div className="flex gap-2">
                {[...Array(4)].map((_, j) => (
                  <div key={j} className="h-8 w-8 bg-border rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
