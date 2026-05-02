export default function ValutazioniLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-9 w-44 bg-border rounded-lg" />
        <div className="h-4 w-64 bg-border rounded" />
      </div>

      {/* Sezione le mie valutazioni */}
      <div className="space-y-4">
        <div className="h-6 w-48 bg-border rounded" />
        <div className="grid gap-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-bg px-5 py-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-6 w-6 rounded-full bg-border shrink-0" />
                <div className="space-y-1.5">
                  <div className="h-4 w-36 bg-border rounded" />
                  <div className="h-3 w-56 bg-border rounded" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-6 w-20 bg-border rounded-full" />
                <div className="h-9 w-28 bg-border rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sezione responsabile */}
      <div className="space-y-4">
        <div className="h-6 w-64 bg-border rounded" />
        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-bg px-5 py-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-6 w-6 rounded-full bg-border shrink-0" />
                <div className="space-y-1.5">
                  <div className="h-4 w-40 bg-border rounded" />
                  <div className="h-3 w-28 bg-border rounded" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-6 w-20 bg-border rounded-full" />
                <div className="h-9 w-24 bg-border rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
