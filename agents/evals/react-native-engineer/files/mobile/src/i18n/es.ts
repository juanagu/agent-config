import type { Dictionary } from "./dictionary";

export const es: Dictionary = {
  tabs: { home: "Inicio", orders: "Pedidos", profile: "Perfil" },
  catalog: {
    inStock: (count: number) => `${count} en stock`,
  },
};
