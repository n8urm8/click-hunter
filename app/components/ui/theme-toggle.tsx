import { useTheme } from "~/hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="fixed top-3 right-3 z-50 w-9 h-9 flex items-center justify-center rounded-full forest-panel border border-forest-light/30 text-gold hover:border-gold/40 hover:text-gold-light transition-colors"
    >
      {theme === "dark" ? "☀" : "🌙"}
    </button>
  );
}
