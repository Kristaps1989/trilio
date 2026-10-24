"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useActionState, useState, useTransition } from "react";
import type { Locker } from "@/services/offers/lockers";
import { Button } from "@/ui/Button";
import { placeOrderAction, type CheckoutState } from "../actions";

// The order form on one phone screen (docs/ADMIN_AND_OFFERS_PLAN.md §11.3):
// at most seven fields for a private buyer, standard autocomplete names so
// the browser fills them, company fields only after "Uzņēmums", one checkbox
// for the terms, and a button that names the amount.

type Defaults = {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  postcode: string;
};

type Props = {
  token: string;
  email: string;
  amount: string;
  deliveryLine: string;
  locker: boolean;
  carryIn: boolean;
  refurbishedGrade: string | null;
  lockers: Locker[];
  paymentsOn: boolean;
  defaults: Defaults;
};

const input =
  "min-h-[52px] w-full rounded-control border-[1.5px] border-mist/35 bg-white-5 px-4 text-[17px] text-mist placeholder:text-stone aria-[invalid=true]:border-warning";
const label = "flex flex-col gap-1.5 text-[15px] font-semibold text-mist";
const chip =
  "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-line-30 px-4 text-[15px] font-semibold text-mist has-[:checked]:border-lime has-[:checked]:bg-lime has-[:checked]:text-night has-[:focus-visible]:outline-2";

export function CheckoutForm(props: Props) {
  const t = useTranslations("checkout");
  const [state, action, pending] = useActionState<CheckoutState, FormData>(placeOrderAction, { errors: {} });
  // With JavaScript the action is dispatched here, so React does not reset the form
  // after a failed submit (the shopper keeps what was typed); without it the plain
  // form action still works.
  const [, startSubmit] = useTransition();
  const keepForm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startSubmit(() => action(data));
  };
  const typed = state.values ?? {};
  const value = (field: keyof Defaults | string) =>
    typed[field] ?? (props.defaults as Record<string, string>)[field] ?? "";
  const [kind, setKind] = useState<"person" | "company">("person");
  const [method, setMethod] = useState<"courier" | "locker">("courier");
  // Controlled: a form reset after a failed submit would otherwise drop the chosen locker.
  const [locker, setLocker] = useState("");
  const err = (field: string) => state.errors[field];
  const errorText = (field: string) => {
    const e = err(field);
    return e ? (
      <span id={`${field}-error`} className="text-sm font-semibold text-warning">
        {t(`error.${e}`)}
      </span>
    ) : null;
  };
  const a11y = (field: string) => ({
    "aria-invalid": err(field) ? true : undefined,
    "aria-describedby": err(field) ? `${field}-error` : undefined,
  });
  const byCity = new Map<string, Locker[]>();
  for (const l of props.lockers) byCity.set(l.city, [...(byCity.get(l.city) ?? []), l]);

  return (
    <form action={action} onSubmit={keepForm} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={props.token} />
      {/* What is submitted comes from state: React resets a submitted form, and the radios
          below would fall back to their first option while the screen still shows the choice. */}
      <input type="hidden" name="buyerKind" value={kind} />
      <input type="hidden" name="deliveryMethod" value={props.locker ? method : "courier"} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[15px] font-semibold text-mist">{t("buyerKind")}</legend>
        <div className="flex gap-2">
          {(["person", "company"] as const).map((k) => (
            <label key={k} className={chip}>
              <input
                type="radio"
                name="buyerKindChoice"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="sr-only"
              />
              {t(`kind_${k}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className={label}>
        {t("fullName")}
        <input
          name="fullName"
          autoComplete="name"
          required
          defaultValue={value("fullName")}
          className={input}
          {...a11y("fullName")}
        />
        {errorText("fullName")}
      </label>
      <label className={label}>
        {t("phone")}
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          defaultValue={value("phone")}
          className={input}
          aria-describedby={err("phone") ? "phone-error" : "phone-hint"}
          aria-invalid={err("phone") ? true : undefined}
        />
        <span id="phone-hint" className="text-sm font-normal text-stone">
          {t("phoneHint")}
        </span>
        {errorText("phone")}
      </label>

      {kind === "company" ? (
        <div className="flex flex-col gap-4 rounded-panel-lg border-[1.5px] border-line-25 p-4">
          <label className={label}>
            {t("companyName")}
            <input
              name="companyName"
              defaultValue={value("companyName")}
              autoComplete="organization"
              required
              className={input}
              {...a11y("companyName")}
            />
            {errorText("companyName")}
          </label>
          <label className={label}>
            {t("companyRegNo")}
            <input
              name="companyRegNo"
              defaultValue={value("companyRegNo")}
              inputMode="numeric"
              required
              className={input}
              {...a11y("companyRegNo")}
            />
            {errorText("companyRegNo")}
          </label>
          <label className={label}>
            {t("companyVatNo")}
            <input
              name="companyVatNo"
              defaultValue={value("companyVatNo")}
              autoCapitalize="characters"
              className={input}
              {...a11y("companyVatNo")}
            />
            {errorText("companyVatNo")}
          </label>
          <label className={label}>
            {t("legalAddress")}
            <input name="legalAddress" defaultValue={value("legalAddress")} className={input} />
          </label>
          <p className="text-sm text-stone">{t("companyNote")}</p>
        </div>
      ) : null}

      {props.locker ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[15px] font-semibold text-mist">{t("deliveryMethod")}</legend>
          <div className="flex flex-wrap gap-2">
            {(["courier", "locker"] as const).map((m) => (
              <label key={m} className={chip}>
                <input
                  type="radio"
                  name="deliveryMethodChoice"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                  className="sr-only"
                />
                {t(`method_${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {method === "courier" || !props.locker ? (
        <>
          <label className={label}>
            {t("street")}
            <input
              name="street"
              autoComplete="address-line1"
              required
              defaultValue={value("street")}
              className={input}
              {...a11y("street")}
            />
            {errorText("street")}
          </label>
          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <label className={label}>
              {t("city")}
              <input
                name="city"
                autoComplete="address-level2"
                required
                defaultValue={value("city")}
                className={input}
                {...a11y("city")}
              />
              {errorText("city")}
            </label>
            <label className={label}>
              {t("postcode")}
              <input
                name="postcode"
                autoComplete="postal-code"
                inputMode="numeric"
                placeholder="LV-1050"
                required
                defaultValue={value("postcode")}
                className={input}
                {...a11y("postcode")}
              />
              {errorText("postcode")}
            </label>
          </div>
        </>
      ) : props.lockers.length ? (
        <label className={label}>
          {t("locker")}
          <select
            name="lockerId"
            required
            value={locker}
            onChange={(e) => setLocker(e.target.value)}
            className={input}
            {...a11y("lockerId")}
          >
            <option value="" disabled>
              {t("lockerPick")}
            </option>
            {[...byCity.entries()].map(([city, list]) => (
              <optgroup key={city} label={city}>
                {list.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.address ? ` — ${l.address}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errorText("lockerId")}
        </label>
      ) : (
        <label className={label}>
          {t("lockerText")}
          <input
            name="lockerId"
            required
            defaultValue={value("lockerId")}
            className={input}
            {...a11y("lockerId")}
          />
          {errorText("lockerId")}
        </label>
      )}

      {props.carryIn ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[15px] font-semibold text-mist">{t("carryIn")}</legend>
          <div className="flex gap-2">
            {(["no", "yes"] as const).map((v) => (
              <label key={v} className={chip}>
                <input
                  type="radio"
                  name="carryIn"
                  value={v}
                  defaultChecked={v === "no"}
                  className="sr-only"
                />
                {t(`carryIn_${v}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className={label}>
        {t("note")}
        <input name="deliveryNote" defaultValue={value("deliveryNote")} className={input} />
      </label>

      <p className="rounded-[14px] bg-lime-12 px-4 py-3 text-[16px] text-mist">{props.deliveryLine}</p>
      <p className="text-sm text-stone">{t("confirmTo", { email: props.email })}</p>

      {props.refurbishedGrade ? (
        <label className="flex min-h-11 items-start gap-3 text-[15px] text-mist">
          <input
            type="checkbox"
            name="refurbished"
            className="mt-0.5 h-5 w-5 shrink-0 accent-lime"
            {...a11y("refurbished")}
          />
          <span>
            {t("refurbishedConfirm", { grade: props.refurbishedGrade })}
            {errorText("refurbished")}
          </span>
        </label>
      ) : null}
      <label className="flex min-h-11 items-start gap-3 text-[15px] text-mist">
        <input
          type="checkbox"
          name="terms"
          className="mt-0.5 h-5 w-5 shrink-0 accent-lime"
          {...a11y("terms")}
        />
        <span>
          {t.rich(kind === "company" ? "termsCompany" : "termsPerson", {
            link: (chunks) => (
              <Link href="/pirkuma-noteikumi" target="_blank" className="underline">
                {chunks}
              </Link>
            ),
          })}
          {errorText("terms")}
        </span>
      </label>

      {state.closed ? (
        <p role="alert" className="text-[15px] font-semibold text-warning">
          {t("closed")}
        </p>
      ) : Object.keys(state.errors).length ? (
        <p role="alert" className="text-[15px] font-semibold text-warning">
          {t("fix")}
        </p>
      ) : null}
      <Button type="submit" size="lg" block disabled={pending}>
        {props.paymentsOn ? t("pay", { amount: props.amount }) : t("acceptOnly")}
      </Button>
      <p className="text-sm text-stone">{props.paymentsOn ? t("paysera") : t("paymentsSoon")}</p>
    </form>
  );
}
