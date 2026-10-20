import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-accent text-paper hover:bg-accent-strong",
  secondary: "border border-line bg-paper text-ink hover:bg-sand",
  ghost: "text-ink hover:bg-sand",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
