import { describe, expect, it } from "vitest";
import {
  normalisePhone,
  normalisePostcode,
  normaliseRegNo,
  normaliseVatNo,
  parseOrderForm,
} from "./checkout";

const ctx = { lockerAllowed: false, refurbished: false, lockerName: () => null };
const person = {
  buyerKind: "person",
  fullName: "Anna Bērziņa",
  phone: "20 000 000",
  street: "Brīvības iela 1-2",
  city: "Rīga",
  postcode: "1050",
  terms: "on",
};

describe("normalising", () => {
  it("postcodes", () => {
    expect(normalisePostcode("1050")).toBe("LV-1050");
    expect(normalisePostcode("lv-1050")).toBe("LV-1050");
    expect(normalisePostcode("LV 1050")).toBe("LV-1050");
    expect(normalisePostcode("105")).toBeNull();
  });
  it("phones", () => {
    expect(normalisePhone("20 000 000")).toBe("+371 20000000");
    expect(normalisePhone("+371 6700-0000")).toBe("+371 67000000");
    expect(normalisePhone("00371 29999999")).toBe("+371 29999999");
    expect(normalisePhone("+37060000000")).toBe("+37060000000");
    expect(normalisePhone("12345")).toBeNull();
  });
  it("company numbers", () => {
    expect(normaliseRegNo("4000 3000 000")).toBe("40003000000");
    expect(normaliseRegNo("4000300000")).toBeNull();
    expect(normaliseVatNo("lv40003000000")).toBe("LV40003000000");
    expect(normaliseVatNo("40003000000")).toBe("LV40003000000");
    expect(normaliseVatNo("EE123")).toBeNull();
  });
});

describe("parseOrderForm", () => {
  it("accepts a private buyer with a courier address", () => {
    const r = parseOrderForm(person, ctx);
    expect(r).toEqual({
      ok: true,
      order: expect.objectContaining({
        buyerKind: "person",
        phone: "+371 20000000",
        postcode: "LV-1050",
        deliveryMethod: "courier",
        carryIn: false,
        companyName: null,
        companyRegNo: null,
      }),
    });
  });
  it("asks for the terms, a valid phone and an address", () => {
    const r = parseOrderForm({ ...person, terms: undefined, phone: "1", street: "", postcode: "x1" }, ctx);
    expect(r).toEqual({
      ok: false,
      errors: { terms: "terms", phone: "phone", street: "required", postcode: "postcode" },
    });
    expect(parseOrderForm({ ...person, postcode: undefined }, ctx)).toMatchObject({
      ok: false,
      errors: { postcode: "required" },
    });
  });
  it("reports missing required fields", () => {
    expect(parseOrderForm({ ...person, fullName: " " }, ctx)).toEqual({
      ok: false,
      errors: { fullName: "required" },
    });
  });
  it("requires company details from a business buyer, VAT number optional but checked", () => {
    expect(parseOrderForm({ ...person, buyerKind: "company" }, ctx)).toMatchObject({
      ok: false,
      errors: { companyName: "required", companyRegNo: "required" },
    });
    expect(
      parseOrderForm(
        { ...person, buyerKind: "company", companyName: "SIA X", companyRegNo: "123", companyVatNo: "x" },
        ctx,
      ),
    ).toMatchObject({ ok: false, errors: { companyRegNo: "regNo", companyVatNo: "vatNo" } });
    const ok = parseOrderForm(
      {
        ...person,
        buyerKind: "company",
        companyName: "SIA X",
        companyRegNo: "40003000000",
        companyVatNo: "40003000000",
      },
      ctx,
    );
    expect(ok).toMatchObject({
      ok: true,
      order: { companyName: "SIA X", companyRegNo: "40003000000", companyVatNo: "LV40003000000" },
    });
  });
  it("takes a parcel locker for small appliances, by id or in words", () => {
    const locker = {
      ...ctx,
      lockerAllowed: true,
      lockerName: (id: string) => (id === "omniva:1" ? "Rīga Centrs" : null),
    };
    const base = {
      buyerKind: "person",
      fullName: "A",
      phone: "20000000",
      deliveryMethod: "locker",
      terms: "on",
    };
    expect(parseOrderForm({ ...base, lockerId: "omniva:1" }, locker)).toMatchObject({
      ok: true,
      order: {
        deliveryMethod: "locker",
        lockerId: "omniva:1",
        lockerName: "Rīga Centrs",
        street: null,
        postcode: null,
      },
    });
    expect(parseOrderForm({ ...base, lockerId: "Imanta Maxima" }, locker)).toMatchObject({
      ok: true,
      order: { lockerName: "Imanta Maxima" },
    });
    expect(parseOrderForm(base, locker)).toMatchObject({ ok: false, errors: { lockerId: "locker" } });
  });
  it("ignores a locker for big appliances and records carry-in", () => {
    const r = parseOrderForm({ ...person, deliveryMethod: "locker", carryIn: "yes" }, ctx);
    expect(r).toMatchObject({ ok: true, order: { deliveryMethod: "courier", carryIn: true } });
  });
  it("needs the refurbished confirmation for a refurbished offer", () => {
    expect(parseOrderForm(person, { ...ctx, refurbished: true })).toMatchObject({
      ok: false,
      errors: { refurbished: "refurbished" },
    });
    expect(parseOrderForm({ ...person, refurbished: "on" }, { ...ctx, refurbished: true })).toMatchObject({
      ok: true,
    });
  });
});
