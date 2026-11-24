import { describe, expect, it } from "vitest";
import { companyFromEnv, fillCompany } from "./company";

describe("company details", () => {
  it("reads trimmed values and defaults the contact e-mail", () => {
    const c = companyFromEnv({ COMPANY_NAME: " SIA Trilio ", COMPANY_REG_NO: "40000000000" });
    expect(c).toEqual({
      name: "SIA Trilio",
      regNo: "40000000000",
      vatNo: "",
      address: "",
      email: "info@trilio.lv",
      iban: "",
      bank: "",
      swift: "",
    });
    expect(companyFromEnv({ COMPANY_EMAIL: "hello@trilio.lv" }).email).toBe("hello@trilio.lv");
    // The account for bank transfers, however it was typed.
    expect(
      companyFromEnv({
        COMPANY_IBAN: " lv80 bank 0000 4351 9500 1 ",
        COMPANY_BANK: " Banka ",
        COMPANY_SWIFT: "banklv22",
      }),
    ).toMatchObject({ iban: "LV80BANK0000435195001", bank: "Banka", swift: "BANKLV22" });
  });

  it("fills placeholders and marks missing values", () => {
    const c = companyFromEnv({ COMPANY_NAME: "SIA Trilio" });
    expect(fillCompany("{company}, Nr. {regNo}, {email}, {site}, {other}", c, "trilio.lv", "—")).toBe(
      "SIA Trilio, Nr. —, info@trilio.lv, trilio.lv, {other}",
    );
  });
});
