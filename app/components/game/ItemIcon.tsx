import { getItemIcon, type ItemIconInput } from "~/lib/itemIcons";
import { cn } from "~/lib/utils";

interface ItemIconProps {
  item: ItemIconInput | null | undefined;
  alt: string;
  className?: string;
}

/**
 * Item placeholder icon. Source art is black on transparent, so render
 * inverted (white) for visibility on the dark forest theme.
 */
export function ItemIcon({ item, alt, className }: ItemIconProps) {
  return (
    <img
      src={getItemIcon(item)}
      alt={alt}
      draggable={false}
      className={cn("size-6 shrink-0 brightness-0 invert", className)}
    />
  );
}
