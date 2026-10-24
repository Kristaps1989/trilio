import Link from "next/link";
import "./globals.css";

// Paths outside the localised routes (an unknown /api/… address, say) end
// here. Pages under [locale] use src/app/[locale]/not-found.tsx.
export default function NotFound() {
  return (
    <html lang="lv">
      <body className="flex min-h-screen items-center justify-center bg-night p-6 text-mist">
        <main className="flex max-w-md flex-col gap-3">
          <h1 className="font-heading text-3xl font-bold">Šādas lapas nav</h1>
          <p lang="en" className="text-stone">
            Page not found.
          </p>
          <Link href="/" className="text-lime underline">
            trilio.lv
          </Link>
        </main>
      </body>
    </html>
  );
}
