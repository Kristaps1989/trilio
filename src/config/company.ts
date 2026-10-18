// Company details shown on the legal pages (Latvian law requires the
// provider's name, registration number, address and e-mail on the site).
// Configuration, not code: set them as environment variables on Railway.

export type Company = {
  name: string;
  regNo: string;
  vatNo: string;
  address: string;
  email: string;
};

export function companyFromEnv(env: Record<string, string | undefined> = process.env): Company {
  const v = (key: string) => (env[key] ?? "").trim();
  return {
    name: v("COMPANY_NAME"),
    regNo: v("COMPANY_REG_NO"),
    vatNo: v("COMPANY_VAT_NO"),
    address: v("COMPANY_ADDRESS"),
    // Contact address for customers and data requests.
    email: v("COMPANY_EMAIL") || "info@trilio.lv",
  };
}

/** Replaces {company}, {regNo}, {address}, {email} and {site} in legal copy; blanks become `missing`. */
export function fillCompany(text: string, company: Company, site: string, missing: string): string {
  const values: Record<string, string> = {
    company: company.name,
    regNo: company.regNo,
    vatNo: company.vatNo,
    address: company.address,
    email: company.email,
    site,
  };
  return text.replace(
    /\{(company|regNo|vatNo|address|email|site)\}/g,
    (_, key: string) => values[key] || missing,
  );
}
