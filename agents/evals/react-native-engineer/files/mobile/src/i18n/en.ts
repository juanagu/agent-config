import type { Dictionary } from "./dictionary";

export const en: Dictionary = {
  tabs: { home: "Home", orders: "Orders", profile: "Profile" },
  catalog: {
    inStock: (count: number) => `${count} in stock`,
  },
};
