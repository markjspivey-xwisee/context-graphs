/**
 * Agent Performance Technology — the complexity-aware, causally-grounded
 * practice of a human consulting on a team of AI agents.
 *
 * This is deliberately NOT Human Performance Technology applied to
 * agents. HPT's gap analysis (actual vs. exemplary, close-the-gap to an
 * ideal future state — Gilbert's Behavior Engineering Model) is a
 * Complicated-domain method: sense ▸ analyse ▸ respond, an expert closes
 * a knowable gap. A team of agents is a COMPLEX adaptive system.
 *
 * So this module refuses the gap/ideal-state frame. Following Snowden
 * (Cynefin ▸ Estuarine mapping, Vector Theory of Change):
 *   · a complex system has DISPOSITIONS and propensities, not a fixable
 *     gap — so we read disposition, not a score-vs-ideal;
 *   · you manage CONSTRAINTS, not outcomes — so a probe nudges a
 *     constraint, never prescribes a target;
 *   · you steer by VECTOR (direction from the present), not toward a
 *     destination;
 *   · you run SAFE-TO-FAIL probes — probe ▸ sense ▸ respond.
 *
 * And Pearl's ladder, which locks into the above rather than fighting it:
 *   · "no causality" in a complex system means no *forward predictive*
 *     causality. Pearl rung 2 (do(x), intervention) IS a safe-to-fail
 *     probe; rung 3 (counterfactual) IS retrospective coherence.
 *   · The agent-trajectory layer already records this: Asserted steps
 *     are observed (rung 1), Hypothetical steps are intentions/probes
 *     (rung 2), Counterfactual steps are the rung-3 roads not taken.
 *
 * Emergent from Interego: composes the agent-trajectory layer; an agent
 * team's disposition is read off its descriptor trajectories. No new
 * ontology term; no gap; no ideal future state.
 */

import type { AgentTrajectory, TrajectoryStep } from './agent-trajectory.js';

// ── Dispositional reading ───────────────────────────────────────────

export type CynefinDomain = 'Clear' | 'Complicated' | 'Complex' | 'Chaotic';

/** A compact disposition snapshot — the rung-2 baseline for a probe. */
export interface DispositionSnapshot {
  asserted: number;
  hypothetical: number;
  counterfactual: number;
  deliberationRatio: number;
  explorationRatio: number;
  toolCallSuccessRate: number;
  cynefinDomain: CynefinDomain;
  takenAt: string;
}

export interface TeamDisposition {
  team: { agentDids: string[]; trajectoryCount: number; stepCount: number };
  /** Modal balance — propensities, descriptive, NOT scored against an ideal. */
  modalBalance: {
    asserted: number;
    hypothetical: number;
    counterfactual: number;
    /** hypothetical / asserted — how much the team plans relative to acting. */
    deliberationRatio: number;
    /** counterfactual / total — how much the team explores roads-not-taken. */
    explorationRatio: number;
    /** supersedes-carrying steps / asserted — how much the team revises plans. */
    planRevisionRatio: number;
  };
  granularityBalance: { task: number; subtask: number; toolCall: number };
  /** tool-call Asserted steps that succeeded / all tool-call Asserted steps. */
  toolCallSuccessRate: number;
  /** Named propensities read off the signals — descriptive, not good/bad. */
  dispositions: Array<{ name: string; reading: string; signal: string }>;
  /** Cynefin placement of the team's behaviour + the stance it calls for. */
  cynefin: { domain: CynefinDomain; rationale: string; stance: string };
  /** Vector of change — direction from the present. NOT a target/gap. */
  vector: { direction: string; basis: string };
  /** Stated plainly so no consumer mistakes this for a gap analysis. */
  method: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Read a team's disposition from its agents' trajectories. */
export function assessDisposition(trajectories: readonly AgentTrajectory[]): TeamDisposition {
  const steps: TrajectoryStep[] = trajectories.flatMap(t => t.steps);
  const agentDids = trajectories.map(t => t.agentDid);

  const asserted = steps.filter(s => s.modalStatus === 'Asserted').length;
  const hypothetical = steps.filter(s => s.modalStatus === 'Hypothetical').length;
  const counterfactual = steps.filter(s => s.modalStatus === 'Counterfactual').length;
  const total = steps.length || 1;
  const supersedingSteps = steps.filter(s => s.supersedesId).length;

  const deliberationRatio = round2(hypothetical / (asserted || 1));
  const explorationRatio = round2(counterfactual / total);
  const planRevisionRatio = round2(supersedingSteps / (asserted || 1));

  const task = steps.filter(s => s.granularity === 'task').length;
  const subtask = steps.filter(s => s.granularity === 'subtask').length;
  const toolCall = steps.filter(s => s.granularity === 'tool-call').length;

  const assertedToolCalls = steps.filter(s => s.modalStatus === 'Asserted' && s.granularity === 'tool-call');
  const toolCallSuccessRate = assertedToolCalls.length > 0
    ? round2(assertedToolCalls.filter(s => s.result?.success !== false).length / assertedToolCalls.length)
    : 0;

  // Named propensities — descriptive readings, no value judgement.
  const dispositions: TeamDisposition['dispositions'] = [];
  if (deliberationRatio >= 0.5) {
    dispositions.push({ name: 'deliberative', signal: `deliberation ratio ${deliberationRatio}`, reading: 'the team forms many intentions relative to actions — it plans heavily.' });
  } else {
    dispositions.push({ name: 'execution-biased', signal: `deliberation ratio ${deliberationRatio}`, reading: 'the team acts more than it plans — low intention-to-action gap.' });
  }
  if (explorationRatio >= 0.12) {
    dispositions.push({ name: 'exploratory', signal: `exploration ratio ${explorationRatio}`, reading: 'the team records many counterfactual branches — it considers and rejects alternatives.' });
  } else {
    dispositions.push({ name: 'committed', signal: `exploration ratio ${explorationRatio}`, reading: 'the team rarely records rejected alternatives — it commits to its first line.' });
  }
  if (planRevisionRatio >= 0.25) {
    dispositions.push({ name: 'plan-revising', signal: `plan-revision ratio ${planRevisionRatio}`, reading: 'executed steps frequently supersede earlier intentions — the team adapts its plan in flight.' });
  } else {
    dispositions.push({ name: 'plan-adhering', signal: `plan-revision ratio ${planRevisionRatio}`, reading: 'executed steps rarely revise intentions — the team holds to its initial plan.' });
  }

  return {
    team: { agentDids, trajectoryCount: trajectories.length, stepCount: steps.length },
    modalBalance: { asserted, hypothetical, counterfactual, deliberationRatio, explorationRatio, planRevisionRatio },
    granularityBalance: { task, subtask, toolCall },
    toolCallSuccessRate,
    dispositions,
    cynefin: placeCynefin({ explorationRatio, planRevisionRatio, task, subtask, toolCall, total, toolCallSuccessRate }),
    vector: readVector(trajectories),
    method: 'Dispositional read (Cynefin / Vector Theory of Change). This is NOT a gap analysis — there is no ideal future state and no score-vs-exemplary. It describes what the team is propense to do and which way it is drifting.',
  };
}

/** Heuristic Cynefin placement of the team's behaviour. */
function placeCynefin(s: {
  explorationRatio: number; planRevisionRatio: number;
  task: number; subtask: number; toolCall: number; total: number; toolCallSuccessRate: number;
}): TeamDisposition['cynefin'] {
  const structured = (s.task + s.subtask) / (s.total || 1) >= 0.25;
  if (s.toolCallSuccessRate < 0.34 && !structured) {
    return { domain: 'Chaotic', rationale: 'low success, no structure — behaviour is not yet patterned.', stance: 'act ▸ sense ▸ respond — stabilise first with a decisive intervention, then re-read.' };
  }
  if (s.explorationRatio >= 0.12 || s.planRevisionRatio >= 0.25) {
    return { domain: 'Complex', rationale: 'the team explores counterfactual branches and revises plans in flight — cause and effect are only coherent in retrospect.', stance: 'probe ▸ sense ▸ respond — run safe-to-fail constraint probes; amplify what coheres, dampen what does not. Do NOT gap-analyse.' };
  }
  if (structured && s.toolCallSuccessRate >= 0.6) {
    return { domain: 'Complicated', rationale: 'structured, hierarchically planned work with reliable outcomes — expert analysis applies.', stance: 'sense ▸ analyse ▸ respond — good practice exists; analysis can find a sound intervention.' };
  }
  return { domain: 'Clear', rationale: 'repetitive, reliable, low-variance behaviour — the relationship between act and outcome is self-evident.', stance: 'sense ▸ categorise ▸ respond — apply best practice; watch only for drift.' };
}

/** Direction of drift from the present — NOT a destination. */
function readVector(trajectories: readonly AgentTrajectory[]): TeamDisposition['vector'] {
  const tc = trajectories
    .flatMap(t => t.steps)
    .filter(s => s.modalStatus === 'Asserted' && s.granularity === 'tool-call')
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  if (tc.length < 4) {
    return { direction: 'indeterminate', basis: 'too little trajectory history to read a vector — run probes and re-read.' };
  }
  const mid = Math.floor(tc.length / 2);
  const rate = (arr: TrajectoryStep[]): number =>
    arr.length ? arr.filter(s => s.result?.success !== false).length / arr.length : 0;
  const before = rate(tc.slice(0, mid));
  const after = rate(tc.slice(mid));
  const delta = round2(after - before);
  if (Math.abs(delta) < 0.05) {
    return { direction: 'holding', basis: `tool-call success steady (${round2(before)} → ${round2(after)}) — no strong drift.` };
  }
  return {
    direction: delta > 0 ? 'drifting toward higher tool-call success' : 'drifting toward lower tool-call success',
    basis: `tool-call success ${round2(before)} → ${round2(after)} across the trajectory timeline (Δ ${delta}).`,
  };
}

export function snapshot(d: TeamDisposition): DispositionSnapshot {
  return {
    asserted: d.modalBalance.asserted,
    hypothetical: d.modalBalance.hypothetical,
    counterfactual: d.modalBalance.counterfactual,
    deliberationRatio: d.modalBalance.deliberationRatio,
    explorationRatio: d.modalBalance.explorationRatio,
    toolCallSuccessRate: d.toolCallSuccessRate,
    cynefinDomain: d.cynefin.domain,
    takenAt: new Date().toISOString(),
  };
}

// ── Safe-to-fail probes (Pearl rung 2 — do(constraint)) ─────────────

/** Snowden's safe-to-fail portfolio: probes are run in parallel, some
 *  coherent with the current disposition, some oblique, some deliberately
 *  contradictory. */
export type ProbeCoherence = 'coherent' | 'oblique' | 'contradictory';

export interface PerformanceProbeInput {
  team: string[];
  /** The CONSTRAINT being nudged — never an outcome. (Snowden: manage
   *  constraints + constructors, not targets.) */
  constraintTarget: string;
  /** Human description of the nudge — a do(x) intervention. */
  change: string;
  coherence: ProbeCoherence;
  hypothesizedEffect: string;
  /** Weak signals declared up-front — what tells you to amplify vs dampen. */
  amplifySignal: string;
  dampenSignal: string;
  recordedBy: string;
}

export interface PerformanceProbe extends PerformanceProbeInput {
  id: string;
  recordedAt: string;
  /** Pearl rung-2 baseline — the disposition at do(x) time. */
  preDisposition: DispositionSnapshot;
}

let _probeCounter = 0;
export function buildProbe(input: PerformanceProbeInput, preDisposition: DispositionSnapshot): PerformanceProbe {
  return {
    ...input,
    id: `urn:foxxi:performance-probe:${Date.now()}-${_probeCounter++}`,
    recordedAt: new Date().toISOString(),
    preDisposition,
  };
}

// ── Causal read (Pearl rung 2 interventional + rung 3 counterfactual) ─

export interface CausalRead {
  probeId: string;
  constraintTarget: string;
  /** Rung 2 — interventional: did the disposition shift after do(probe)? */
  rung2: {
    before: DispositionSnapshot;
    after: DispositionSnapshot;
    shift: string;
    movedAsHypothesised: boolean;
  };
  /** Rung 3 — counterfactual: what the team would otherwise have done,
   *  read from the Counterfactual branches its agents recorded. */
  rung3: { reading: string; basis: string };
  /** Honest epistemics — this is retrospective coherence, not prediction. */
  caveat: string;
  /** Snowden: amplify what coheres, dampen what does not, else let it run. */
  recommendation: 'amplify' | 'dampen' | 'let-run';
  recommendationRationale: string;
}

/** Compute the causal read for a probe given the team's current trajectories. */
export function computeCausalRead(
  probe: PerformanceProbe,
  currentTrajectories: readonly AgentTrajectory[],
): CausalRead {
  const after = snapshot(assessDisposition(currentTrajectories));
  const before = probe.preDisposition;

  const dSuccess = round2(after.toolCallSuccessRate - before.toolCallSuccessRate);
  const dExploration = round2(after.explorationRatio - before.explorationRatio);
  const dDeliberation = round2(after.deliberationRatio - before.deliberationRatio);
  const domainChanged = before.cynefinDomain !== after.cynefinDomain;

  const shiftParts: string[] = [];
  if (dSuccess !== 0) shiftParts.push(`tool-call success ${dSuccess > 0 ? '+' : ''}${dSuccess}`);
  if (dExploration !== 0) shiftParts.push(`exploration ${dExploration > 0 ? '+' : ''}${dExploration}`);
  if (dDeliberation !== 0) shiftParts.push(`deliberation ${dDeliberation > 0 ? '+' : ''}${dDeliberation}`);
  if (domainChanged) shiftParts.push(`Cynefin domain ${before.cynefinDomain} → ${after.cynefinDomain}`);
  const shift = shiftParts.length > 0 ? shiftParts.join(', ') : 'no measurable shift in the disposition snapshot';

  // The probe hypothesised an effect; did the disposition move at all in a
  // direction consistent with a real intervention effect?
  const movedAsHypothesised = dSuccess > 0 || domainChanged || Math.abs(dExploration) > 0.05;

  // Rung 3 — counterfactual reading from the recorded Counterfactual steps.
  const cfSteps = currentTrajectories.flatMap(t => t.steps).filter(s => s.modalStatus === 'Counterfactual');
  const rung3 = cfSteps.length > 0
    ? {
        reading: `Absent the probe, the team's recorded counterfactual branches indicate it would otherwise have pursued: ${[...new Set(cfSteps.map(s => s.objectName))].slice(0, 4).join('; ')}.`,
        basis: `${cfSteps.length} Counterfactual trajectory step(s) — the roads the agents considered and rejected.`,
      }
    : {
        reading: 'No counterfactual branches were recorded, so the rung-3 reading is unavailable — the team did not surface the roads it did not take.',
        basis: '0 Counterfactual trajectory steps.',
      };

  let recommendation: CausalRead['recommendation'];
  let recommendationRationale: string;
  if (movedAsHypothesised && dSuccess >= 0) {
    recommendation = 'amplify';
    recommendationRationale = `the disposition moved in a coherent direction after do(${probe.constraintTarget}); amplify — run more probes of this kind.`;
  } else if (dSuccess < -0.05 || (domainChanged && after.cynefinDomain === 'Chaotic')) {
    recommendation = 'dampen';
    recommendationRationale = `the disposition degraded after do(${probe.constraintTarget}); dampen — withdraw this probe (it was safe-to-fail; this is the cheap failure working as intended).`;
  } else {
    recommendation = 'let-run';
    recommendationRationale = 'no clear coherence yet; let the probe run longer before judging — complex systems show their shape only over time.';
  }

  return {
    probeId: probe.id,
    constraintTarget: probe.constraintTarget,
    rung2: { before, after, shift, movedAsHypothesised },
    rung3,
    caveat: 'This is RETROSPECTIVE COHERENCE, not a predictive causal claim. In a complex system the disposition shifted after the intervention; that the probe *caused* it can only ever be read in hindsight, never forecast.',
    recommendation,
    recommendationRationale,
  };
}
