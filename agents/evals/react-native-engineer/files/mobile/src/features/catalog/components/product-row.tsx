import { StyleSheet, Text, View } from "react-native";
import { useT } from "@/i18n/use-t";
import { theme } from "@/shared/theme";
import type { Product } from "../lib/products";

export function ProductRow({ product }: { product: Product }) {
  const t = useT();

  return (
    <View style={styles.row}>
      <Text style={styles.title}>{product.title}</Text>
      <Text style={styles.price}>{"$" + product.priceCents / 100}</Text>
      <Text style={styles.stock}>{t.catalog.inStock(product.stock)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: theme.space.m, paddingHorizontal: theme.space.m },
  title: { color: theme.color.ink, fontSize: theme.font.body },
  price: { color: theme.color.ink, fontSize: 14, marginTop: 2 },
  stock: { color: "#B00020", fontSize: theme.font.caption },
});
