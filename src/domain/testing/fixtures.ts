import { getSubcategory } from "@/domain/questions/catalog";
import { SubcategorySchema, type Subcategory } from "@/domain/questions/schema";

// A test-only fridge variant that asks for the height as a slider limit and
// the niche as a number, so the range and number question types (still used
// by the results-page editor and available to any category) stay covered
// now that the real categories ask for sizes as picture cards.

const fridge = getSubcategory("fridge")!;
const real = (id: string) => fridge.questions.find((q) => q.id === id)!;

export const limitsFridge: Subcategory = SubcategorySchema.parse({
  ...fridge,
  questions: [
    real("install"),
    {
      id: "height",
      title: "Cik augsts var būt ledusskapis?",
      type: "range",
      hard_filter: true,
      stage: "flow",
      up_front_reason: "fit",
      showIf: { q: "install", in: ["free"] },
      range: {
        attr: "height_cm",
        unit: "cm",
        min: 120,
        max: 210,
        step: 1,
        bound: "max",
        presets: [186, 200],
        toleranceAbove: 0.5,
      },
      options: [],
    },
    {
      id: "niche",
      title: "Cik augsta ir niša?",
      type: "number",
      hard_filter: true,
      stage: "flow",
      up_front_reason: "fit",
      showIf: { q: "install", in: ["builtin"] },
      input: {
        min: 80,
        max: 220,
        default: 178,
        unit: "cm",
        step: 1,
        attr: "height_cm",
        toleranceBelow: 6,
        toleranceAbove: 0.5,
      },
      options: [],
    },
    real("hinge"),
    real("household"),
    real("priorities"),
  ],
});
