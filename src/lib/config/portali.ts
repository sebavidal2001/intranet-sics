export const PORTALE_SLUGS = {
  VALUTAZIONI: "valutazioni",
  PREVENTIVATORE: "preventivatore",
  VETTORI: "vettori",
} as const;

export type PortaleSlug = typeof PORTALE_SLUGS[keyof typeof PORTALE_SLUGS];
