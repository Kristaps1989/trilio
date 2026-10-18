import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, enabledProviders, signIn, signOut } from "@/auth";
import { Button } from "@/ui/Button";
import { GoogleButton } from "@/ui/GoogleButton";
import { InfoBox, Kicker, PageTitle, Screen } from "@/ui/layout";

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
    "min-h-[52px] w-full rounded-control border-[1.5px] border-mist/35 bg-white-5 px-4 text-[17px] text-mist placeholder:text-stone";
  const anyProvider = enabledProviders.google || enabledProviders.email || enabledProviders.dev;

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      <PageTitle>{t("title")}</PageTitle>
      <p className="-mt-1 text-[17px] leading-normal text-stone">{t("why")}</p>

      {session?.user ? (
        <form
          className="flex flex-col gap-3"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <InfoBox>{t("signedInAs", { email: session.user.email ?? "" })}</InfoBox>
          <div>
            <Button type="submit" variant="outline">
              {t("signOut")}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-1 flex flex-col gap-[10px]">
        {enabledProviders.google ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: target });
            }}
          >
            <GoogleButton label={t("google")} />
          </form>
        ) : null}

        {enabledProviders.google && enabledProviders.email ? (
          <div className="my-1.5 flex items-center gap-3 text-sm text-stone" aria-hidden="true">
            <span className="h-px flex-1 bg-line-20" />
            {t("or")}
            <span className="h-px flex-1 bg-line-20" />
          </div>
        ) : null}

        {enabledProviders.email ? (
          sent ? (
            <div role="status">
              <InfoBox>{t("emailSent")}</InfoBox>
            </div>
          ) : (
            <form
              className="flex flex-col gap-[10px]"
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
              <label htmlFor="login-email" className="text-[15px] font-semibold text-mist">
                {t("emailLabel")}
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="tavs@epasts.lv"
                className={inputClass}
              />
              <Button type="submit" variant="outline" block>
                {t("emailSubmit")}
              </Button>
            </form>
          )
        ) : null}

        {enabledProviders.dev ? (
          <form
            className="mt-2 flex flex-col gap-3 rounded-[14px] border border-dashed border-warning p-4"
            action={async (formData: FormData) => {
              "use server";
              await signIn("dev", { email: String(formData.get("email") ?? ""), redirectTo: target });
            }}
          >
            <h2 className="text-base font-bold text-warning">{t("devLogin")}</h2>
            <label className="flex flex-col gap-2 text-[15px] font-semibold text-mist">
              <span>{t("emailLabel")}</span>
              <input name="email" type="email" required className={inputClass} />
            </label>
            <Button type="submit" variant="outline" block>
              {t("devSubmit")}
            </Button>
          </form>
        ) : null}
      </div>

      {anyProvider ? (
        <p className="mt-1 text-[13px] leading-normal text-stone">
          {t.rich("consent", {
            terms: (chunks) => (
              <Link href="/noteikumi" className="text-mist underline">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href="/privatums" className="text-mist underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : (
        <p className="text-base text-stone">{t("noProviders")}</p>
      )}
    </Screen>
  );
}
