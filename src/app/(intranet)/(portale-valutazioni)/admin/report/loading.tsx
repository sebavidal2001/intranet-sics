export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-border rounded-lg w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 bg-border rounded-xl" />
        ))}
      </div>
    </div>
  );
}
