"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const BG_PINK = "#FFDEF0";
const BRAND_GREEN = "#1B8900";

export default function AboutPage() {
  const pathname = usePathname() || "/";

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`navLink ${active ? "isActive" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="page">
      <style>{`
        @font-face{
          font-family:"Seatren";
          src:url("/fonts/Seatren.woff") format("woff");
          font-weight:400;
          font-style:normal;
          font-display:swap;
        }
        @font-face{
          font-family:"Hanken Grotesk";
          src:url("/fonts/HankenGrotesk-Regular.ttf") format("truetype");
          font-weight:400;
          font-style:normal;
          font-display:swap;
        }
        @font-face{
          font-family:"Hanken Grotesk";
          src:url("/fonts/HankenGrotesk-Bold.ttf") format("truetype");
          font-weight:700;
          font-style:normal;
          font-display:swap;
        }

       .page{min-height:100vh;background:#FFDEF0;position:relative;overflow-x:hidden;overflow-y:visible;}


        /* HERO BACKGROUND (big heart swirl) */
        .heroBg{
          position:absolute;
          left:0;
          right:0;
          top:0;
          height:750px;
          pointer-events:none;
          background-image:url("/heartswirl.svg");
          background-repeat:no-repeat;
          background-position:center top;
          background-size:1400px auto;
          z-index:0;
        }

        .wrap{
          position:relative;
          max-width:1100px;
          margin:0 auto;
          padding:52px 40px 84px;
          z-index:1;
        }

        /* Top row */
        .topRow{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:24px;
        }
        .logo{
          width:190px;
          height:auto;
          display:block;
        }
        .nav{
          display:flex;
          gap:18px;
          align-items:center;
          margin-top:10px;
        }
        .navLink{
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:14px;
          color:#111;
          text-decoration:none;
        }
        .navLink.isActive{
          font-weight:700;
          text-decoration:underline;
          text-underline-offset:4px;
        }

        /* Hero */
        .hero{
          margin-top:104px;
          text-align:center;
          display:flex;
          flex-direction:column;
          align-items:center;
        }
        .heroTitle{
          font-family:"Seatren",system-ui,-apple-system,Segoe UI,Arial;
          font-size:60px;
          line-height:1;
          color:${BRAND_GREEN};
          margin:0;
          font-weight:400;
        }
        .heroStatement{
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:36px;
          line-height:1.15;
          margin:26px 0 0;
          color:#5B5B5B;
          max-width:680px;
          font-weight:700;
        }
        .heroLead{
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:18px;
          line-height:1.6;
          margin:18px 0 0;
          color:#111;
          max-width:560px;
        }

        .divider{
          height:1px;
          background:#E7E7E7;
          margin:62px 0 0;
        }

        /* Main two-column section (matches Figma composition) */
        .section2{
          margin-top:44px;
          display:grid;
          grid-template-columns:1.05fr 1fr;
          gap:54px;
          align-items:start;
        }

        .peopleImg{
          width:100%;
          height:auto;
          display:block;
          border-radius:2px;
        }

        .h2{
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:26px;
          line-height:1.2;
          margin:6px 0 12px;
          color:#111;
          font-weight:700;
        }
        .h2 u{ text-underline-offset:6px; }

        .p{
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:13px;
          line-height:1.55;
          margin:0;
          color:#111;
        }
        .p + .p{ margin-top:12px; }
        .pGreen{
          color:${BRAND_GREEN};
          font-weight:700;
          margin-top:18px;
        }
        .pStrong{
          font-weight:700;
          margin-top:14px;
        }

        /* Cards placed like Figma: pink under image, grey under copy */
        .cardLeft{
          background:#F7CFE5;
          padding:26px 26px 28px;
          border-radius:2px;
          margin-top:26px;
        }
    

        /* Footer bar */
        .footerBar{
          margin-top:56px;
       
          padding-top:18px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          font-family:"Hanken Grotesk",system-ui,-apple-system,Segoe UI,Arial;
          font-size:12px;
          color:#111;
          opacity:.8;
        }
        .footerLinks{
          display:flex;
          gap:18px;
        }
        .footerLinks a{
          color:inherit;
          text-decoration:none;
        }

        /* Responsive */
        @media (max-width: 960px){
          .wrap{padding:40px 22px 72px;}
          .heroBg{background-size:1200px auto;height:720px;}
          .hero{margin-top:92px;}
          .heroTitle{font-size:54px;}
          .heroStatement{font-size:32px;}
          .section2{grid-template-columns:1fr;gap:28px;}
          .cardRightText{max-width:100%;}
          .ctaGrid{grid-template-columns:1fr;}
        }
      `}</style>

      {/* HERO BACKGROUND */}
      <div className="heroBg" />

      <div className="wrap">
        {/* TOP ROW */}
  

        {/* HERO */}
        <section className="hero">
          <h1 className="heroTitle">About EqualType</h1>
          <div className="heroStatement">
            Language shapes
            <br />
            how we see the world.
          </div>
          <p className="heroLead">
            The words we choose can include, exclude, empower, or unintentionally harm. Yet most of the time,
            harmful language isn’t written with bad intentions. It’s written out of habit, lack of awareness,
            or cultural blind spots.
          </p>
        </section>

        <div className="divider" />

        {/* SECTION 2 (Figma layout) */}
       <section className="aboutSection">
  {/* Top row: image + text */}
  <div className="aboutTop">
    <img className="aboutImg" src="/about/hero-people.png" alt="" />
    <div className="aboutTopText">
      <h3>EqualType exists to close that gap.</h3>
      <p>
        We help individuals, teams, and organizations write with greater clarity, respect,
        and awareness, without policing language or limiting expression.
      </p>
      <p style={{ color: "#1B8900", fontWeight: 600 }}>
        EqualType analyzes text in real time, highlights potentially discriminatory or exclusionary wording,
        and suggests clearer, more inclusive alternatives.
      </p>
      <p>Our goal is simple: to make thoughtful communication easier for everyone.</p>
    </div>
  </div>

  {/* Middle cards */}
  <div className="aboutGrid">
    <div className="aboutCardPink">
      <h3 className="aboutCardTitle">Why We Built EqualType</h3>
      <p className="aboutCardSubB">
       Discriminator language doesn’t always look obvious.</p>
     
         <p className="aboutCardBody">
        It can hide in stereotypes, outdated terms, assumptions, or phrases that have caused harm over time.
      </p>
    </div>

    <div className="aboutCardGray">
      <p className="aboutCardBody" style={{ fontSize: 24, lineHeight: "31px", color: "#1B8900" }}>
        EqualType is designed to sit exactly in between, helping people understand why certain language can be harmful
        and offering better ways to say the same thing, without judgment.
      </p>
    </div>
  </div>

  {/* Support section */}
  <div className="aboutSupport">
    <h3>How You Can Support EqualType</h3>
    <p>
      EqualType is built to serve the public good. Keeping it accurate, accessible, and continuously improving
      requires ongoing research, testing, and development.
    </p>

    <div className="aboutSupportRow">
      <div className="supportCardGreen">
        <h4 className="supportTitle supportTitleLight">Use and Share EqualType</h4>
        <p className="supportBody supportBodyLight">
          Every use helps refine our understanding of real-world language patterns. Sharing EqualType with your team,
          school, or community helps amplify its impact.
        </p>
      </div>

      <div className="supportCardYellow">
        <h4 className="supportTitle supportTitleDark">Give Feedback</h4>
        <p className="supportBody supportBodyDark">
          Inclusive language is deeply contextual and culturally nuanced. Your feedback helps us improve accuracy,
          reduce false positives, and expand coverage across regions and communities.
        </p>
        <a className="supportEmail" href="mailto:support@equaltype.com">support@equaltype.com</a>
      </div>
    </div>
  </div>
</section>

      </div>
    </div>
  );
}
