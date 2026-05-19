import React from 'react';
import { callBridge } from '../bridge-client.js';
import type { DemoStep } from '../components/DemoCard.js';

/**
 * Learning-engineer demo steps. LEs are the cross of instructional
 * designer + data scientist + ML engineer. They DESIGN learning
 * experiments, ANALYZE cohort outcomes, CALIBRATE assessments, and
 * ITERATE on competency frameworks.
 *
 * Each card composes affordances Ngozi (the demo LE) would actually
 * use day-to-day.
 */
export const leSteps: DemoStep[] = [
  {
    title: 'Pre-register an A/B experiment',
    subtitle: 'foxxi.le_design_ab_experiment',
    body: (
      <>
        You want to know if rewriting Golf Explained with a worked-example-first sequence
        produces a 5pp completion-rate lift over the current explain-first version. The
        bridge runs a two-proportion power analysis — returns the required sample size,
        the statistical test, and the estimated experiment duration given your tenant's
        enrolment rate. Pre-registration locks the analysis plan and prevents p-hacking.
      </>
    ),
    actionLabel: 'Design A/B for Golf Explained',
    run: () => callBridge({
      tool: 'foxxi.le_design_ab_experiment',
      args: {
        variant_a: { courseId: 'golf-explained', courseTitle: 'Golf Explained — explain-first (control)' },
        variant_b: { courseId: 'golf-explained-v2', courseTitle: 'Golf Explained — worked-example-first (treatment)' },
        primary_metric: 'completion-rate',
        minimum_detectable_effect: 0.05,
        alpha: 0.05,
        power: 0.8,
        randomization: 'stratified-by-audience-tag',
        per_week_enrolment: 25,
      },
      identity: 'ngozi',
    }),
    summarize: (r) => {
      const x = r as { sampleSize?: { perVariant?: number; total?: number }; estimatedDurationDays?: number };
      return x?.sampleSize ? `n=${x.sampleSize.perVariant}/arm · ${x.estimatedDurationDays}d` : 'no result';
    },
    explainer: (r) => {
      const x = r as { experimentId?: string; sampleSize?: { perVariant?: number; total?: number; rationale?: string }; analysisPlan?: { primaryTest?: string }; estimatedDurationDays?: number };
      if (!x?.sampleSize) return <em>Bridge returned an error.</em>;
      return (
        <>
          To detect a 5pp completion-rate lift at α=0.05 with 80% power, you need
          <strong> {x.sampleSize.perVariant} learners per arm</strong> ({x.sampleSize.total} total).
          At ~25 enrollments per week (stratified randomization), the experiment runs
          <strong> {x.estimatedDurationDays} days</strong>. Primary test:
          <code> {x.analysisPlan?.primaryTest}</code>. The experiment plan is now an
          auditable artifact (id: <code>{x.experimentId}</code>) — locks the analysis plan
          before you see any data.
        </>
      );
    },
  },

  {
    title: 'Estimate concept difficulty',
    subtitle: 'foxxi.le_estimate_concept_difficulty',
    body: (
      <>
        Which concepts in Golf Explained are objectively the hardest? The bridge composes the
        prereq-graph topology (deeper concepts depend on more) with cohort question-
        frequency (concepts learners ask the most about). Returns a ranked list with
        per-concept rationale — your starting point for which concepts need additional
        scaffolding, more practice, or to be split into smaller chunks.
      </>
    ),
    actionLabel: 'Rank Golf Explained concepts by difficulty',
    run: () => callBridge({
      tool: 'foxxi.le_estimate_concept_difficulty',
      args: { course_id: 'golf-explained' },
      identity: 'ngozi',
    }),
    summarize: (r) => {
      const arr = r as Array<{ conceptLabel?: string }>;
      return Array.isArray(arr) ? `${arr.length} concepts ranked` : 'no result';
    },
    explainer: (r) => {
      const arr = r as Array<{ conceptId: string; conceptLabel?: string; difficultyEstimate: number; components?: { isFoundational?: boolean; prereqDepth?: number } }>;
      if (!Array.isArray(arr)) return <em>Bridge returned an error.</em>;
      const top = arr.slice(0, 5);
      return (
        <>
          {arr.length} concepts ranked by composite difficulty (prereq depth 60% + cohort
          struggle 40%). Top 5 hardest:
          <ul style={{ marginTop: 8, marginBottom: 0 }}>
            {top.map(c => (
              <li key={c.conceptId} style={{ marginBottom: 4 }}>
                <strong>{c.conceptLabel ?? c.conceptId}</strong> · {c.difficultyEstimate.toFixed(2)}
                {c.components?.isFoundational && <em style={{ color: 'var(--accent)' }}> · foundational</em>}
                {c.components?.prereqDepth ? ` · ${c.components.prereqDepth} ancestors` : ''}
              </li>
            ))}
          </ul>
        </>
      );
    },
  },

  {
    title: 'Detect a learning-curve plateau',
    subtitle: 'foxxi.le_analyze_learning_curve',
    body: (
      <>
        After 3 attempts at the handicap concept, your cohort's mastery rate
        plateaus at 64% — additional attempts aren't producing additional learning.
        The bridge ingests per-attempt outcomes, finds the plateau, and recommends an
        action: rising → keep going; high plateau → enough mastery; low plateau → the
        material needs rework or scaffolding. Replaces "give them another quiz and hope"
        with a data-driven instructional-design decision.
      </>
    ),
    actionLabel: 'Analyze handicap cohort attempts',
    run: () => callBridge({
      tool: 'foxxi.le_analyze_learning_curve',
      args: {
        concept_id: 'handicap',
        concept_label: 'Handicap calculation',
        attempts: [
          // attempt 1: most learners struggle
          { learnerId: 'u-joshua', attemptNumber: 1, mastered: false },
          { learnerId: 'u0107', attemptNumber: 1, mastered: false },
          { learnerId: 'u0021', attemptNumber: 1, mastered: true },
          { learnerId: 'u0150', attemptNumber: 1, mastered: false },
          // attempt 2: improving
          { learnerId: 'u-joshua', attemptNumber: 2, mastered: true },
          { learnerId: 'u0107', attemptNumber: 2, mastered: false },
          { learnerId: 'u0150', attemptNumber: 2, mastered: true },
          { learnerId: 'u0001', attemptNumber: 2, mastered: true },
          // attempt 3: plateau begins
          { learnerId: 'u0107', attemptNumber: 3, mastered: false },
          { learnerId: 'u0033', attemptNumber: 3, mastered: false },
          { learnerId: 'u0044', attemptNumber: 3, mastered: true },
          // attempt 4: plateau confirmed
          { learnerId: 'u0107', attemptNumber: 4, mastered: false },
          { learnerId: 'u0033', attemptNumber: 4, mastered: false },
          { learnerId: 'u0044', attemptNumber: 4, mastered: true },
          // attempt 5: plateau hardened
          { learnerId: 'u0107', attemptNumber: 5, mastered: false },
          { learnerId: 'u0033', attemptNumber: 5, mastered: true },
          { learnerId: 'u0044', attemptNumber: 5, mastered: true },
        ],
      },
      identity: 'ngozi',
    }),
    summarize: (r) => {
      const x = r as { diagnosis?: string; plateauDetectedAtAttempt?: number; plateauRate?: number };
      return x?.diagnosis ? `${x.diagnosis}${x.plateauDetectedAtAttempt ? ` at attempt ${x.plateauDetectedAtAttempt}` : ''}` : 'no result';
    },
    explainer: (r) => {
      const x = r as { diagnosis?: string; plateauDetectedAtAttempt?: number; plateauRate?: number; recommendation?: string; curve?: Array<{ attemptNumber: number; cumulativeMasteryRate: number }> };
      if (!x?.diagnosis) return <em>Bridge returned an error.</em>;
      return (
        <>
          <strong>Diagnosis:</strong> {x.diagnosis}
          {x.plateauDetectedAtAttempt !== undefined ? ` (plateau at attempt ${x.plateauDetectedAtAttempt}, mastery ${((x.plateauRate ?? 0) * 100).toFixed(0)}%)` : ''}.
          {' '}{x.recommendation}
          <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)' }}>
            curve: {x.curve?.map(p => `att${p.attemptNumber}=${(p.cumulativeMasteryRate * 100).toFixed(0)}%`).join(' → ')}
          </div>
        </>
      );
    },
  },

  {
    title: 'Calibrate the cmi5 mastery threshold',
    subtitle: 'foxxi.le_calibrate_mastery_threshold',
    body: (
      <>
        The cmi5 spec lets you set any mastery threshold (default 1.0; typical 0.7).
        What threshold actually predicts whether your learners will succeed in the next
        prereq-dependent lesson? The bridge runs ROC analysis over historical
        score-vs-outcome data, returns the threshold that maximizes Youden's J
        (true-positive rate minus false-positive rate). Empirically grounded
        threshold-setting replaces "we use 0.8 because that feels right."
      </>
    ),
    actionLabel: 'Calibrate threshold against downstream success',
    run: () => callBridge({
      tool: 'foxxi.le_calibrate_mastery_threshold',
      args: {
        records: [
          { scoreScaled: 0.50, downstreamSuccess: false },
          { scoreScaled: 0.55, downstreamSuccess: false },
          { scoreScaled: 0.62, downstreamSuccess: false },
          { scoreScaled: 0.65, downstreamSuccess: true },
          { scoreScaled: 0.70, downstreamSuccess: false },
          { scoreScaled: 0.72, downstreamSuccess: true },
          { scoreScaled: 0.75, downstreamSuccess: true },
          { scoreScaled: 0.78, downstreamSuccess: true },
          { scoreScaled: 0.80, downstreamSuccess: true },
          { scoreScaled: 0.85, downstreamSuccess: true },
          { scoreScaled: 0.88, downstreamSuccess: true },
          { scoreScaled: 0.92, downstreamSuccess: true },
          { scoreScaled: 0.95, downstreamSuccess: true },
        ],
      },
      identity: 'ngozi',
    }),
    summarize: (r) => {
      const x = r as { optimalThreshold?: number };
      return x?.optimalThreshold !== undefined ? `optimal threshold: ${x.optimalThreshold}` : 'no result';
    },
    explainer: (r) => {
      const x = r as { optimalThreshold?: number; rationale?: string; rocCurve?: Array<{ threshold: number; youdensJ: number }> };
      if (x?.optimalThreshold === undefined) return <em>Bridge returned an error.</em>;
      const top3 = (x.rocCurve ?? []).slice().sort((a, b) => b.youdensJ - a.youdensJ).slice(0, 3);
      return (
        <>
          <strong>Optimal mastery threshold: {x.optimalThreshold}</strong> — {x.rationale}
          <div style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-dim)' }}>
            top-3 thresholds by Youden's J: {top3.map(p => `${p.threshold} (J=${p.youdensJ})`).join('; ')}
          </div>
        </>
      );
    },
  },

  {
    title: 'Find gaps between your framework and what you teach',
    subtitle: 'foxxi.le_framework_gap_analysis',
    body: (
      <>
        Cross-reference the tenant's competency framework against the concepts
        actually taught in published courses. Surfaces (a) competencies in the
        framework with no taught concept (assessments referencing them can't be
        grounded), and (b) taught concepts not aligned to any competency (credentials
        issued for these can't reference the framework). Coverage % gives you a single
        KPI for instructional-design completeness.
      </>
    ),
    actionLabel: 'Audit framework ↔ taught-concept coverage',
    run: () => callBridge({
      tool: 'foxxi.le_framework_gap_analysis',
      args: {
        framework_skills: [
          { id: 'urn:foxxi:comp:handicap', label: 'Handicap calculation' },
          { id: 'urn:foxxi:comp:pace-of-play', label: 'pace of play' },
          { id: 'urn:foxxi:comp:difficult-lie-recovery', label: 'Difficult lie recovery' },
          { id: 'urn:foxxi:comp:lockout-tagout', label: 'Lockout-tagout safety' }, // no taught concept
          { id: 'urn:foxxi:comp:protective-relaying', label: 'Protective relaying' }, // no taught concept
        ],
        course_concepts: [
          { id: 'handicap', label: 'handicap', confidence: 0.93, tier: 1 },
          { id: 'pace-of-play', label: 'pace of play', confidence: 0.91, tier: 1 },
          { id: 'difficult-lie-recovery', label: 'difficult lie recovery', confidence: 0.88, tier: 1 },
          { id: 'course-par', label: 'course par', confidence: 0.85, tier: 2 }, // unaligned
          { id: 'golf-controls-basics', label: 'golf rules basics', confidence: 0.82, tier: 2 }, // unaligned
        ],
        alignments: [
          { skillId: 'urn:foxxi:comp:handicap', conceptId: 'handicap' },
          { skillId: 'urn:foxxi:comp:pace-of-play', conceptId: 'pace-of-play' },
          { skillId: 'urn:foxxi:comp:difficult-lie-recovery', conceptId: 'difficult-lie-recovery' },
        ],
      },
      identity: 'ngozi',
    }),
    summarize: (r) => {
      const x = r as { alignmentCoveragePct?: number; competenciesWithoutTaughtConcepts?: unknown[]; conceptsNotAlignedToAnyCompetency?: unknown[] };
      return x ? `${x.alignmentCoveragePct}% coverage · ${x.competenciesWithoutTaughtConcepts?.length}/${(x.competenciesWithoutTaughtConcepts?.length ?? 0) + (x.conceptsNotAlignedToAnyCompetency?.length ?? 0)} gaps` : 'no result';
    },
    explainer: (r) => {
      const x = r as { summary?: string; alignmentCoveragePct?: number; competenciesWithoutTaughtConcepts?: Array<{ competencyLabel?: string }>; conceptsNotAlignedToAnyCompetency?: Array<{ conceptLabel?: string }> };
      if (!x?.summary) return <em>Bridge returned an error.</em>;
      return (
        <>
          <strong>{x.summary}</strong>
          {(x.competenciesWithoutTaughtConcepts?.length ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <em>Competencies missing a taught concept:</em>{' '}
              {x.competenciesWithoutTaughtConcepts!.map(c => c.competencyLabel).join(', ')}
            </div>
          )}
          {(x.conceptsNotAlignedToAnyCompetency?.length ?? 0) > 0 && (
            <div style={{ marginTop: 8 }}>
              <em>Concepts not aligned to any framework competency:</em>{' '}
              {x.conceptsNotAlignedToAnyCompetency!.map(c => c.conceptLabel).join(', ')}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-dim)' }}>
            Either build courses that teach the missing competencies, or remove them from
            the framework. Either align the unaligned concepts to existing competencies,
            or add new competencies for them.
          </div>
        </>
      );
    },
  },
];
