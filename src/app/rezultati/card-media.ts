import { IMAGE_HOSTS } from "@/db/stores";
import { energyLabel, imageSrc, type EnergyLabel } from "@/domain/catalog/media";
import type { ProductView } from "@/domain/catalog/types";
import { getSubcategory } from "@/domain/questions/catalog";

export type CardImage = { src: string | null; fallback: string | null };

/** The card's photo (or the subcategory drawing) and EPREL energy label. */
export function cardMedia(p: ProductView): { image: CardImage; energyLabel: EnergyLabel | null } {
  return {
    image: {
      src: imageSrc(p.imageUrl, IMAGE_HOSTS),
      fallback: getSubcategory(p.subcategoryId)?.illustration ?? null,
    },
    energyLabel: energyLabel(p.eprelId, p.attributes.energy_class),
  };
}
