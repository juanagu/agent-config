"use server";

import { cookies } from "next/headers";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

const LOCALE_COOKIE = "app_locale";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale): Promise<void> {
  if (!LOCALES.includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR_SECONDS });
}
