"use client";
import Header from "../components/Header";
import React from "react";
import Link from "next/link";

const BG_PINK = "#FFDEF0";

export default function PrivacyPage() {
  return (
    <div className="page">
      <style>{`
        @font-face{font-family:"Hanken Grotesk";src:url("/fonts/HankenGrotesk-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap;}
        @font-face{font-family:"Hanken Grotesk";src:url("/fonts/HankenGrotesk-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap;}

        .page{background:#FFDEF0;position:relative;overflow:hidden;display:flex;flex-direction:column;}


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
          <h1>Privacy Policy</h1>
          <div className="meta">Last updated: 2026-01-11</div>

          <div className="block">
            <ol>
              <li>
                <span className="itemTitle">What we collect</span>
                <p>
                  We may collect basic usage data (e.g., request timing, error logs). If you submit text for analysis,
                  it is sent to our API for processing.
                </p>
              </li>

              <li>
                <span className="itemTitle">How we use data</span>
                <p>We use data to operate the Service, improve quality, prevent abuse, and troubleshoot issues.</p>
              </li>

              <li>
                <span className="itemTitle">Data retention</span>
                <p>We aim to minimize retention. Logs may be kept for a limited time for security and debugging.</p>
              </li>

              <li>
                <span className="itemTitle">Third parties</span>
                <p>
                  If we use an AI provider to process text, your text may be shared with that provider strictly to
                  provide the analysis.
                </p>
              </li>

              <li>
                <span className="itemTitle">Your choices</span>
                <p>
                  Avoid submitting sensitive personal information. If you need deletion requests, contact:
                  <br />
                  support@equaltype.com
                </p>
              </li>

              <li>
                <span className="itemTitle">Updates</span>
                <p>We may update this policy from time to time. Continued use means you accept the updated policy.</p>
              </li>
            </ol>
          </div>
        </div>
      </div>

      
    </div>
  );
}
