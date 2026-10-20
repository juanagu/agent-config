import { z } from "zod";

export const productSchema = z.object({
  id: z.string(),
  title: z.string(),
  priceCents: z.number().int(),
  stock: z.number().int().nonnegative(),
});

export type Product = z.infer<typeof productSchema>;
