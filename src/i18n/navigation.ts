import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware Link, redirect, usePathname and useRouter: on an English page
// "/izvelies" becomes "/en/izvelies"; usePathname returns the path without
// the prefix.

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
