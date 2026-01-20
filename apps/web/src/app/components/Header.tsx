"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname() || "/";

  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`navLink ${active ? "active" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <header>
      <div className="siteContainer">
        <div className="siteHeader">
          <img src="/equaltype-logo.svg" alt="EqualType" className="logo" />

          <nav className="nav" aria-label="Primary">
            {/* Home'dayken Home'u sakla */}
            {pathname !== "/" && link("/", "Home")}
            {link("/about", "About")}

          </nav>
        </div>
      </div>
    </header>
  );
}
