import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Container } from "@/ui/layout";
import { AdminNav } from "./AdminNav";
import { requireAdmin } from "./guard";

// /admin: the owner's section (docs/ADMIN_AND_OFFERS_PLAN.md §4). Every page
// below is gated here and again in each action.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Trilio" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // One reader, Latvian: there is no /en/admin.
  if ((await params).locale !== "lv") notFound();
  await requireAdmin();
  const t = await getTranslations("admin.nav");
  const items = [
    { href: "/admin", label: t("today") },
    { href: "/admin/statistika", label: t("stats") },
    { href: "/admin/lietotaji", label: t("users") },
    { href: "/admin/pieprasijums", label: t("demand") },
    { href: "/admin/piedavajumi", label: t("offers") },
    { href: "/admin/pasutijumi", label: t("orders") },
    { href: "/admin/reklama", label: t("ads") },
    { href: "/admin/sistema", label: t("system") },
  ];
  return (
    <div className="pt-3 pb-12">
      <Container size="wide" className="flex flex-col gap-5">
        <AdminNav items={items} label={t("label")} />
        {children}
      </Container>
    </div>
  );
}
