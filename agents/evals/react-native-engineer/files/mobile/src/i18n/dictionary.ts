export type Dictionary = {
  tabs: { home: string; orders: string; profile: string };
  catalog: {
    inStock: (count: number) => string;
  };
};
