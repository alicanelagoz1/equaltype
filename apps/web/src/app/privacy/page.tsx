"use client";
import Header from "../components/Header";
import React from "react";
import Link from "next/link";

const BG_PINK = "#FFDEF0";

export default function TermsPage() {
  return (
    <div className="page">
      <style>{`
        @font-face{font-family:"Hanken Grotesk";src:url("/fonts/HankenGrotesk-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap;}
        @font-face{font-family:"Hanken Grotesk";src:url("/fonts/HankenGrotesk-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap;}

        .page{background:${BG_PINK};position:relative;overflow:hidden;}

        .shell{position:relative;max-width:980px;margin:0 auto;padding:28px 24px 90px;}
        .brandRow{display:flex;align-items:flex-start;}
        .logo{width:190px;height:auto;}

        .content{margin-top:28px;max-width:640px;}
        h1{font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:34px;line-height:1.1;margin:0;color:#111;font-weight:700;}
        .meta{margin-top:10px;font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:14px;color:#111;opacity:.85;}
        .block{margin-top:18px;font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:14px;line-height:1.55;color:#111;}
        .block b{font-weight:700;}
        .block p{margin:0 0 12px;}
        .block ol{margin:10px 0 0 18px;padding:0;}
        .block li{margin:10px 0;}
        .block .itemTitle{font-weight:700;display:block;margin-bottom:4px;}

        .footer{position:absolute;left:0;right:0;bottom:0;}
        .footerInner{max-width:980px;margin:0 auto;padding:16px 24px 18px;display:flex;justify-content:space-between;align-items:center;font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;font-size:12px;color:#222;opacity:.8;}
        .footerLinks{display:flex;gap:22px;}
        .footer a{color:inherit;text-decoration:none;}
        .footerLine{height:1px;background:#111;opacity:.25;max-width:980px;margin:0 auto;}
      `}</style>

      <div className="loopBg" />

     <div className="shell">
    

        <div className="content">
          <h1>Terms &amp; Conditions</h1>
          <div className="meta">Last updated: 2026-01-11</div>

          <div className="block">
            <ol>
              <li>
                <span className="itemTitle">Overview</span>
                <p>
                  EqualType helps you review text for potentially discriminatory or exclusionary language. The Service
                  provides suggestions, not legal advice.
                </p>
              </li>

              <li>
                <span className="itemTitle">User Content</span>
                <p>
                  You are responsible for the text you submit. Do not submit sensitive personal data you do not have
                  the right to share.
                </p>
              </li>

              <li>
                <span className="itemTitle">No Warranty</span>
                <p>
                  Outputs are generated automatically and may be incomplete or incorrect. You should review and use
                  your judgment before publishing any text.
                </p>
              </li>

              <li>
                <span className="itemTitle">Acceptable Use</span>
                <p>
                  You agree not to use the Service to harass, incite violence, or produce unlawful discriminatory
                  content.
                </p>
              </li>

              <li>
                <span className="itemTitle">Limitation of Liability</span>
                <p>
                  To the maximum extent permitted by law, EqualType is not liable for any damages resulting from your
                  use of the Service.
                </p>
              </li>

              <li>
                <span className="itemTitle">Changes</span>
                <p>We may update these Terms from time to time. Continued use means you accept the updated Terms.</p>
              </li>

              <li>
                <span className="itemTitle">Contact</span>
                <p>For questions, contact us at: support@equaltype.com</p>
              </li>
            </ol>
          </div>
        </div>
      </div>


    </div>
  );
}
