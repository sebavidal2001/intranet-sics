export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-border rounded-lg w-64" />
      <div className="h-4 bg-border rounded w-40" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-border rounded-xl" />
        ))}
      </div>
    </div>
  );
}
