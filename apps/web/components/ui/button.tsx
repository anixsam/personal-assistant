import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-bg hover:bg-accent/90 font-medium",
  ghost: "text-muted hover:text-fg hover:bg-panel-2",
  outline: "border border-line text-fg hover:bg-panel-2",
  danger: "border border-bad/40 text-bad hover:bg-bad/10",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  icon: "h-9 w-9 justify-center",
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  ({ className, variant = "ghost", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
