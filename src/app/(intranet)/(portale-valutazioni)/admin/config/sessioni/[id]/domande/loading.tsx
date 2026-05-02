export default function DomandeLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-3 w-16 bg-border rounded" />
            {i < 3 && <div className="h-3 w-2 bg-border rounded" />}
          </div>
        ))}
      </div>

      {/* Header sessione */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-72 bg-border rounded-lg" />
          <div className="h-4 w-56 bg-border rounded" />
        </div>
        <div className="h-7 w-20 bg-border rounded-full" />
      </div>

      {/* Sezione dipendenti */}
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="h-5 w-40 bg-border rounded" />
          <div className="h-3 w-64 bg-border rounded" />
        </div>

        {/* Righe dipendenti */}
        <div className="rounded-xl border border-border bg-bg divide-y divide-border overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-border shrink-0" />
                <div className="space-y-1.5">
                  <div className="h-4 w-40 bg-border rounded" />
                  <div className="h-3 w-24 bg-border rounded" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-6 w-20 bg-border rounded-full" />
                <div className="h-8 w-28 bg-border rounded-lg" />
                <div className="h-8 w-8 bg-border rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
