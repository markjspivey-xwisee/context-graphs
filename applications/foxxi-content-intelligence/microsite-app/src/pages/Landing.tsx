import React from 'react';

export function Landing({ onTry, onAbout }: { onTry: (role: 'learner' | 'admin' | 'le') => void; onAbout: () => void }) {
  return (
    <>
      {/* Hero */}
      <section style={{ maxWidth: 980, margin: '60px auto 30px', padding: '0 24px' }}>
        <div className="label" style={{ marginBottom: 14 }}>L&amp;D · open · pod-native · standards-conformant</div>
        <h1 style={{
          fontFamily: "'EB Garamond', serif", fontStyle: 'italic',
          fontSize: 64, lineHeight: 1.05, margin: 0, letterSpacing: '-0.02em',
        }}>
          Learning records<br />you actually own.
        </h1>
        <p style={{
          fontSize: 21, lineHeight: 1.5, maxWidth: 720, marginTop: 22, color: 'var(--text-dim)',
        }}>
          Foxxi turns every course completion, assessment, and competency assertion into a
          cryptographically-verifiable credential that lives in <em>your</em> data pod — not your
          employer's HRIS, not an LMS vendor's database. Show only what you want, prove what you
          must, take it with you forever.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }}>
          <PrimaryCta onClick={() => onTry('learner')}>Try it as a learner →</PrimaryCta>
          <SecondaryCta onClick={() => onTry('admin')}>Try it as an L&amp;D admin →</SecondaryCta>
          <SecondaryCta onClick={() => onTry('le')}>Try it as a learning engineer →</SecondaryCta>
          <SecondaryCta onClick={onAbout}>How it works</SecondaryCta>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 16, fontFamily: "'JetBrains Mono', monospace" }}>
          no signup · runs against a real cloud-deployed substrate · stops working when you close the tab
        </div>
      </section>

      {/* What is this — 4 value props */}
      <section style={{ maxWidth: 1100, margin: '60px auto 0', padding: '0 24px' }}>
        <div className="label" style={{ marginBottom: 20 }}>Four things you can't easily do today</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <ValueProp
            title="Selective disclosure"
            blurb="Prove you're competent in handicap control without revealing your score, employer, or any other course you've taken. BBS+ zero-knowledge proofs make this real."
          />
          <ValueProp
            title="Cross-org portability"
            blurb="Move from Acme Training to PartnerCo, hand over your pod URL, your credentials follow. No re-credentialing, no spreadsheet hand-offs, no PDF transcripts."
          />
          <ValueProp
            title="AI-mentored learning"
            blurb="An AI agent reviews your work + signs a CompetencyAssertion VC — modal status Hypothetical. A human admin countersigns to elevate it to a real OB3 badge."
          />
          <ValueProp
            title="One-query audit trail"
            blurb="For regulators, one descriptor query returns every cmi5 completion → OB3 credential → CASE competency alignment → policy citation → SOC 2 control. Cryptographically verifiable end-to-end."
          />
        </div>
      </section>

      {/* Standards row */}
      <section style={{ maxWidth: 1100, margin: '60px auto 0', padding: '0 24px' }}>
        <div className="label" style={{ marginBottom: 12 }}>Composes the standards stack you already invested in</div>
        <div style={{
          padding: 18, background: 'var(--panel)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-dim)', lineHeight: 1.8,
        }}>
          ADL SCORM 1.2 / 2004 · ADL xAPI 1.0.3 / 2.0.0 (IEEE 9274.1.1) ·
          ADL cmi5 (IEEE 9274.2.1, all 9 statements) · IEEE LOM 1484.12.1 ·
          IEEE RDCEO/RCD 1484.20 · 1EdTech CASE 1.0 · ADL CaSS ·
          1EdTech Open Badges 3.0 · 1EdTech CLR 1.0 + 2.0 ·
          W3C Verifiable Credentials 2.0 (vc-jwt + eddsa-jcs-2022 + eddsa-rdfc-2022 + bbs-2023) ·
          W3C DIDs (did:key + did:web + did:ethr) ·
          ADL TLA Master Object Model · ADL TLA Experience Index (write + read-side federation)
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          Every conformance claim is wired to source code in the public repo.
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{
        maxWidth: 980, margin: '60px auto', padding: '40px 24px',
        background: 'var(--text)', color: 'var(--panel)',
        borderRadius: 8,
      }}>
        <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 32, lineHeight: 1.2 }}>
          Five real bridge calls, three minutes, no signup.
        </div>
        <div style={{ marginTop: 12, color: 'rgba(245,239,226,0.75)', fontSize: 15 }}>
          The try-it-now flow runs every demo against the live deployed bridge — same code path
          a production tenant would use. Pick a side:
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          <PrimaryCta onClick={() => onTry('learner')} inverse>I'm a learner →</PrimaryCta>
          <PrimaryCta onClick={() => onTry('admin')} inverse>I'm an L&amp;D admin →</PrimaryCta>
          <PrimaryCta onClick={() => onTry('le')} inverse>I'm a learning engineer →</PrimaryCta>
        </div>
      </section>
    </>
  );
}

function PrimaryCta({ children, onClick, inverse }: { children: React.ReactNode; onClick: () => void; inverse?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: '14px 22px',
      background: inverse ? 'var(--accent)' : 'var(--text)',
      color: inverse ? 'var(--panel)' : 'var(--panel)',
      border: 'none', borderRadius: 4,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>{children}</button>
  );
}

function SecondaryCta({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '13px 20px',
      background: 'transparent', color: 'var(--text)',
      border: '1.5px solid var(--text)', borderRadius: 4,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13, fontWeight: 500,
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>{children}</button>
  );
}

function ValueProp({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div style={{
      padding: 20, background: 'var(--panel)',
      border: '1px solid var(--border)', borderRadius: 6,
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{
        fontFamily: "'EB Garamond', serif", fontStyle: 'italic',
        fontSize: 22, marginBottom: 10, color: 'var(--text)',
      }}>{title}</div>
      <div style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.55 }}>{blurb}</div>
    </div>
  );
}
