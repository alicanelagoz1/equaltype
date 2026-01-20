"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="siteFooter">
      <div className="siteContainer siteFooterInner">
        <div className="siteFooterLeft">© 2026 EqualType. All rights reserved.</div>

        <div className="siteFooterRight">
          <Link href="/terms">Terms &amp; Conditions</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </div>
      </div>
    </footer>
  );
}
