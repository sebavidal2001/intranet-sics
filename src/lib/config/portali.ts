export const PORTALE_SLUGS = {
  VALUTAZIONI: "valutazioni",
  PREVENTIVATORE: "preventivatore",
} as const;

export type PortaleSlug = typeof PORTALE_SLUGS[keyof typeof PORTALE_SLUGS];
