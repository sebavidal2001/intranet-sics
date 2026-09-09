import { z } from "zod";
export const MailConfig = z.object({
  vettore_id: z.string().uuid().nullable(),
  oggetto: z.string().trim().min(1).max(250).refine((s) => !/[\r\n]/.test(s), "L’oggetto deve essere su una sola riga."),
  corpo: z.string().trim().min(1).max(30000),
  destinatari: z.array(z.string().trim().email()).max(20),
  cc: z.array(z.string().trim().email()).max(20),
});
export type ConfigMail = z.infer<typeof MailConfig>;
