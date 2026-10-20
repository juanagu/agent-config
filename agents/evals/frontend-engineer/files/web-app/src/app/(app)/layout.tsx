import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/features/auth/lib/get-session";
import { AccountMenu } from "@/features/account/components/account-menu";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-line px-4 py-3 md:px-8">
        <Link href="/home" className="font-display text-xl">
          Tidepool
        </Link>
        <AccountMenu email={session.email} />
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
