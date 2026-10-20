import { Tabs } from "expo-router";
import { useT } from "@/i18n/use-t";
import { theme } from "@/shared/theme";

export default function TabsLayout() {
  const t = useT();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.surface },
        headerTitleStyle: { color: theme.color.ink },
        tabBarActiveTintColor: theme.color.accent,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t.tabs.home }} />
      <Tabs.Screen name="orders" options={{ title: t.tabs.orders }} />
      <Tabs.Screen name="profile" options={{ title: t.tabs.profile }} />
    </Tabs>
  );
}
