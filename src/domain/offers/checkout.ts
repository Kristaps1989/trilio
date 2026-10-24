import { z } from "zod";

// The order form (docs/ADMIN_AND_OFFERS_PLAN.md §5, §9, §11): private buyers
// give a name, a phone and where it goes; businesses add company details.
// Values are normalised here so invoices and couriers get one format.

/** "1050", "lv1050", "LV-1050" → "LV-1050". */
export function normalisePostcode(raw: string): string | null {
  const m = raw.trim().match(/^(?:lv)?[\s-]?(\d{4})$/i);
  return m ? `LV-${m[1]}` : null;
}

/** Latvian numbers (8 digits starting 2 or 6) get +371; other countries keep their own code. */
export function normalisePhone(raw: string): string | null {
  const compact = raw.replace(/[\s()-]/g, "");
  const lv = compact.match(/^(?:\+371|00371)?([26]\d{7})$/);
  if (lv) return `+371 ${lv[1]}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

/** Latvian company registration number: 11 digits. */
export function normaliseRegNo(raw: string): string | null {
  const digits = raw.replace(/\s/g, "");
  return /^\d{11}$/.test(digits) ? digits : null;
}

/** Latvian VAT number: "LV" + 11 digits; the prefix may be omitted. */
export function normaliseVatNo(raw: string): string | null {
  const compact = raw.replace(/\s/g, "").toUpperCase();
  const m = compact.match(/^(?:LV)?(\d{11})$/);
  return m ? `LV${m[1]}` : null;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export type FieldError =
  "required" | "postcode" | "phone" | "regNo" | "vatNo" | "terms" | "refurbished" | "locker";

export type OrderForm = {
  buyerKind: "person" | "company";
  fullName: string;
  phone: string;
  street: string | null;
  city: string | null;
  postcode: string | null;
  deliveryMethod: "courier" | "locker";
  lockerId: string | null;
  lockerName: string | null;
  carryIn: boolean;
  deliveryNote: string | null;
  companyName: string | null;
  companyRegNo: string | null;
  companyVatNo: string | null;
  legalAddress: string | null;
};

const Raw = z.object({
  buyerKind: z.enum(["person", "company"]).default("person"),
  fullName: text(120),
  phone: text(30),
  street: optional(200),
  city: optional(80),
  postcode: optional(12),
  deliveryMethod: z.enum(["courier", "locker"]).default("courier"),
  lockerId: optional(40),
  carryIn: z.enum(["yes", "no"]).optional(),
  deliveryNote: optional(500),
  companyName: optional(200),
  companyRegNo: optional(20),
  companyVatNo: optional(20),
  legalAddress: optional(300),
  terms: z.literal("on").optional(),
  refurbished: z.literal("on").optional(),
});

/**
 * Validates the submitted form. `lockers` resolves a locker id to its name
 * (null when the locker list is unavailable: then the id field holds what
 * the buyer typed). Returns the clean order or the fields to fix.
 */
export function parseOrderForm(
  input: Record<string, string | undefined>,
  ctx: {
    lockerAllowed: boolean;
    refurbished: boolean;
    lockerName: (id: string) => string | null;
  },
): { ok: true; order: OrderForm } | { ok: false; errors: Partial<Record<string, FieldError>> } {
  const parsed = Raw.safeParse(input);
  const errors: Partial<Record<string, FieldError>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] = "required";
    return { ok: false, errors };
  }
  const v = parsed.data;
  const phone = normalisePhone(v.phone);
  if (!phone) errors.phone = "phone";
  const method = ctx.lockerAllowed ? v.deliveryMethod : "courier";

  let postcode: string | null = null;
  let lockerName: string | null = null;
  if (method === "courier") {
    if (!v.street) errors.street = "required";
    if (!v.city) errors.city = "required";
    postcode = v.postcode ? normalisePostcode(v.postcode) : null;
    if (!postcode) errors.postcode = v.postcode ? "postcode" : "required";
  } else {
    if (!v.lockerId) errors.lockerId = "locker";
    else lockerName = ctx.lockerName(v.lockerId) ?? v.lockerId;
  }

  let regNo: string | null = null;
  let vatNo: string | null = null;
  if (v.buyerKind === "company") {
    if (!v.companyName) errors.companyName = "required";
    regNo = v.companyRegNo ? normaliseRegNo(v.companyRegNo) : null;
    if (!regNo) errors.companyRegNo = v.companyRegNo ? "regNo" : "required";
    if (v.companyVatNo) {
      vatNo = normaliseVatNo(v.companyVatNo);
      if (!vatNo) errors.companyVatNo = "vatNo";
    }
  }
  if (v.terms !== "on") errors.terms = "terms";
  if (ctx.refurbished && v.refurbished !== "on") errors.refurbished = "refurbished";
  if (Object.keys(errors).length) return { ok: false, errors };

  const company = v.buyerKind === "company";
  return {
    ok: true,
    order: {
      buyerKind: v.buyerKind,
      fullName: v.fullName,
      phone: phone!,
      street: method === "courier" ? v.street : null,
      city: method === "courier" ? v.city : null,
      postcode,
      deliveryMethod: method,
      lockerId: method === "locker" ? v.lockerId : null,
      lockerName,
      carryIn: !ctx.lockerAllowed && v.carryIn === "yes",
      deliveryNote: v.deliveryNote,
      companyName: company ? v.companyName : null,
      companyRegNo: company ? regNo : null,
      companyVatNo: company ? vatNo : null,
      legalAddress: company ? v.legalAddress : null,
    },
  };
}
