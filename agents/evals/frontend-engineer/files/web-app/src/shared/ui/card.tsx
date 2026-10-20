import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-md border border-line bg-paper shadow-sm">{children}</section>;
}
