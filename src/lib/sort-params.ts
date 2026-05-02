export function parseSortParams(
  params: Record<string, string | undefined>,
  defaultSort: string,
  defaultDir: "asc" | "desc" = "asc"
): { sort: string; dir: "asc" | "desc" } {
  return {
    sort: params.sort ?? defaultSort,
    dir: (params.dir === "desc" ? "desc" : "asc") as "asc" | "desc",
  };
}
