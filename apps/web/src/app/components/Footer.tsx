import Link from "next/link";

export default function Footer() {
  return (
    <footer className="siteFooter">
      <div className="siteContainer">
        <div className="siteFooterRow">
          <div>© 2026 EqualType. All rights reserved.</div>

          <div className="siteFooterLinks">
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/privacy">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
