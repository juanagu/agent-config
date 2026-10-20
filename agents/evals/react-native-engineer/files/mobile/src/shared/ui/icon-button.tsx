import { Pressable, type PressableProps } from "react-native";
import { theme } from "@/shared/theme";

type IconButtonProps = PressableProps & {
  accessibilityLabel: string;
  children: React.ReactNode;
};

export function IconButton({ children, style, ...props }: IconButtonProps) {
  return (
    <Pressable
      hitSlop={theme.space.s}
      style={[{ minHeight: theme.size.control, minWidth: theme.size.control, alignItems: "center", justifyContent: "center" }, style as object]}
      {...props}
    >
      {children}
    </Pressable>
  );
}
