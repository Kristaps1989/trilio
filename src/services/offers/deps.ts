import { offerSignature } from "@/config/admin";
import { companyFromEnv, companyLine } from "@/config/company";
import { createEmailSender } from "@/services/notify/email";
import { appBaseUrl } from "@/services/payments";
import type { MailDeps } from "./emails";

/** E-mail, links and signature for offers and orders, from the environment. */
export function offerMailDeps(): MailDeps {
  return {
    email: createEmailSender(),
    baseUrl: appBaseUrl(),
    signature: offerSignature(),
    inbox: companyFromEnv().email,
    company: companyLine(companyFromEnv()),
  };
}
