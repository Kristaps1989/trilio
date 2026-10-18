import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, enabledProviders, signIn, signOut } from "@/auth";
import { PrimaryButton } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ callbackUrl?: string; sent?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("title") };
}

function safeCallback(url: string | undefined): string {
  return url && url.startsWith("/") && !url.startsWith("//") ? url : "/radars";
}

/** Google and email magic link (Apple deferred). Real <form>s so it works without JS. */
export default async function SignInPage({ searchParams }: Props) {
  const { callbackUrl, sent } = await searchParams;
  const t = await getTranslations("auth");
  const session = await auth();
  const target = safeCallback(callbackUrl);
  if (session?.user && !sent) redirect(target);

  const inputClass =
    "min-h-14 w-full rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 text-[17px] text-mist";

  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>
      <p className="mt-2 text-base text-stone">{t("why")}</p>

      {session?.user ? (
        <form
          className="mt-6 flex flex-col gap-3"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <p className="text-base text-mist">{t("signedInAs", { email: session.user.email ?? "" })}</p>
          <PrimaryButton type="submit" variant="secondary">
            {t("signOut")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-6 flex flex-col gap-3">
        {enabledProviders.google ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: target });
            }}
          >
            <PrimaryButton type="submit" variant="light" className="border border-mist-32">
              {t("google")}
            </PrimaryButton>
          </form>
        ) : null}

        {enabledProviders.email ? (
          <form
            className="flex flex-col gap-3"
            action={async (formData: FormData) => {
              "use server";
              await signIn("resend", {
                email: String(formData.get("email") ?? ""),
                redirectTo: target,
                redirect: false,
              });
              redirect(`/ienakt?sent=1&callbackUrl=${encodeURIComponent(target)}`);
            }}
          >
            <h2 className="text-lg font-bold text-mist">{t("emailTitle")}</h2>
            {sent ? (
              <p className="text-base text-lime" role="status">
                {t("emailSent")}
              </p>
            ) : null}
            <label className="flex flex-col gap-2 text-base font-semibold text-mist">
              <span>{t("emailLabel")}</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                className={inputClass}
              />
            </label>
            <PrimaryButton type="submit">{t("emailSubmit")}</PrimaryButton>
          </form>
        ) : null}

        {enabledProviders.dev ? (
          <form
            className="flex flex-col gap-3 rounded-[14px] border border-dashed border-warning p-4"
            action={async (formData: FormData) => {
              "use server";
              await signIn("dev", { email: String(formData.get("email") ?? ""), redirectTo: target });
            }}
          >
            <h2 className="text-base font-bold text-warning">{t("devLogin")}</h2>
            <label className="flex flex-col gap-2 text-base font-semibold text-mist">
              <span>{t("emailLabel")}</span>
              <input name="email" type="email" required className={inputClass} />
            </label>
            <PrimaryButton type="submit" variant="secondary">
              {t("devSubmit")}
            </PrimaryButton>
          </form>
        ) : null}

        {!enabledProviders.google && !enabledProviders.email && !enabledProviders.dev ? (
          <p className="text-base text-stone">{t("noProviders")}</p>
        ) : null}
      </div>
    </Shell>
  );
}
