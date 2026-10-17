import { describe, expect, it } from "vitest";
import { csvAdapter, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and semicolons", () => {
    const rows = parseCsv('a;b\r\n"x;1";"he said ""hi"""\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x;1", 'he said "hi"'],
    ]);
  });
  it("detects tabs", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("csvAdapter", () => {
  const body = [
    "id,title,link,price,availability,gtin,brand,mpn,condition,product_type,shipping_days",
    'K1,"Bosch TWK3P423 tējkanna",https://shop.example.com/k1,"39,99 EUR",in_stock,4242005072972,Bosch,TWK3P423,new,Tējkannas,2',
    "K2,Nezināms,https://shop.example.com/k2,19.90,in_stock,,,,new,Tējkannas,",
    "T1,TV,https://shop.example.com/t1,499,in_stock,,,,new,Televizori,",
  ].join("\n");

  it("parses rows using the default Google column names", () => {
    const r = csvAdapter.parse(body, { slug: "shop", categoryMap: { Tējkannas: "kettle" } });
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]).toMatchObject({
      externalId: "K1",
      ean: "4242005072972",
      modelCode: "TWK3P423",
      priceCents: 3999,
      deliveryEtaDays: 2,
      subcategoryId: "kettle",
    });
    expect(r.rejected.map((x) => x.reason)).toEqual(["no_identity", "unmapped_category"]);
  });

  it("maps custom headers through columnMap", () => {
    const lv = [
      "Kods;Nosaukums;Saite;Cena;Pieejamība;EAN;Kategorija",
      "K1;Tējkanna;https://shop.example.com/k1;29,90;Ir noliktavā;4242005072972;Tējkannas",
    ].join("\n");
    const r = csvAdapter.parse(lv, {
      slug: "shop",
      categoryMap: { Tējkannas: "kettle" },
      columnMap: {
        Kods: "id",
        Nosaukums: "title",
        Saite: "link",
        Cena: "price",
        Pieejamība: "availability",
        EAN: "gtin",
        Kategorija: "product_type",
      },
    } as never);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]).toMatchObject({ priceCents: 2990, stock: "in", modelCode: "4242005072972" });
  });

  it("rejects a feed without id and price columns", () => {
    const r = csvAdapter.parse("foo,bar\n1,2", { slug: "shop" });
    expect(r.offers).toEqual([]);
    expect(r.rejected[0]!.reason).toMatch(/header/);
  });
});
