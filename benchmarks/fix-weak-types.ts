#!/usr/bin/env tsx
/**
 * Focus on the two weak categories: temporal (82%) and multi-session (68%).
 * Test multiple strategies per question and find what works.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! });
const MODEL = 'claude-sonnet-4-20250514';

async function llm(prompt: string, mt = 500) {
  const r = await anthropic.messages.create({ model: MODEL, max_tokens: mt, messages: [{ role: 'user', content: prompt }] });
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

function ft(sessions: string[]) { return sessions.map((s, i) => `=== Session ${i + 1} ===\n${s}`).join('\n\n'); }

async function judge(q: string, gen: string, gold: string): Promise<boolean> {
  const v = await llm(`Same core info? Numbers must match. Just "yes" or "no".\nQ: ${q}\nGen: ${gen.slice(0, 600)}\nGold: ${gold}\nCorrect?`, 10);
  return v.toLowerCase().replace(/[*"'\s]/g, '').startsWith('yes');
}

// Strategy A: Agentic decomposition (current)
async function temporalAgentic(sessions: string[], q: string): Promise<string> {
  const plan = await llm(`Question: "${q}"\nExtraction tasks? JSON: [{"what": "desc", "type": "date|duration|number"}]`, 300);
  let tasks: any[] = [];
  try { const m = plan.match(/\[[\s\S]*\]/); if (m) tasks = JSON.parse(m[0]); } catch {}
  if (!tasks.length) tasks = [{ what: 'temporal info', type: 'date' }];
  const exts: string[] = [];
  for (const t of tasks.slice(0, 4)) {
    const r = await llm(`Find "${t.what}". EXACT ${t.type}.\n\n${ft(sessions)}\n\n${t.what}:`, 200);
    exts.push(`${t.what}: ${r}`);
  }
  return llm(`Answer from these facts ONLY. Specific answer only.\n\n${exts.join('\n')}\n\nQ: ${q}\nA:`, 100);
}

// Strategy B: Full session with chain-of-thought
async function temporalCoT(sessions: string[], q: string): Promise<string> {
  return llm(`Read ALL sessions carefully. Answer this temporal question step by step.

Step 1: Identify the key events/dates mentioned in the question.
Step 2: Search ALL sessions for these events and their exact dates/times.
Step 3: Calculate the answer (difference, ordering, or specific time).
Step 4: State ONLY the final answer.

${ft(sessions)}

Question: ${q}

Step 1:`, 800);
}

// Strategy C: Two-pass for temporal (extract ALL dates, then answer)
async function temporalTwoPass(sessions: string[], q: string): Promise<string> {
  // First: extract ALL temporal information from all sessions
  const allDates = await llm(`List EVERY date, time, duration, and temporal reference in these conversations.
Format: "Event: date/time"
Include relative references like "last week", "three days later", etc.

${ft(sessions)}

All temporal facts:`, 800);

  return llm(`Using these temporal facts, answer the question.

Temporal facts:
${allDates}

Question: ${q}

Specific answer:`, 200);
}

const data = JSON.parse(readFileSync(resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json'), 'utf-8'));

async function main() {
  // Test temporal strategies
  const temporalQs = data.filter((d: any) => d.question_type === 'temporal-reasoning').slice(0, 20);

  console.log('\n=== TEMPORAL STRATEGIES (20q) ===\n');

  const results: Record<string, { correct: number; total: number }> = {
    agentic: { correct: 0, total: 0 },
    cot: { correct: 0, total: 0 },
    twopass: { correct: 0, total: 0 },
  };

  for (const item of temporalQs) {
    const sessions: string[] = item.haystack_sessions.map((s: any) =>
      typeof s === 'string' ? s : Array.isArray(s) ? s.map((t: any) => typeof t === 'string' ? t : (t.content || t.text || '')).join(' ') : JSON.stringify(s));

    // Run all 3 strategies
    const [a1, a2, a3] = await Promise.all([
      temporalAgentic(sessions, item.question),
      temporalCoT(sessions, item.question),
      temporalTwoPass(sessions, item.question),
    ]);

    const [j1, j2, j3] = await Promise.all([
      judge(item.question, a1, String(item.answer)),
      judge(item.question, a2, String(item.answer)),
      judge(item.question, a3, String(item.answer)),
    ]);

    results.agentic.total++;
    results.cot.total++;
    results.twopass.total++;
    if (j1) results.agentic.correct++;
    if (j2) results.cot.correct++;
    if (j3) results.twopass.correct++;

    // Show if any strategy got it that others missed
    if (!j1 && (j2 || j3)) {
      console.log(`AGENTIC MISSED: ${item.question.slice(0, 60)}`);
      console.log(`  Gold: ${String(item.answer).slice(0, 60)}`);
      console.log(`  Agentic: ${a1.slice(0, 60)}`);
      if (j2) console.log(`  CoT CORRECT: ${a2.slice(0, 60)}`);
      if (j3) console.log(`  TwoPass CORRECT: ${a3.slice(0, 60)}`);
      console.log();
    }
  }

  console.log('Temporal results:');
  for (const [name, r] of Object.entries(results)) {
    console.log(`  ${name}: ${r.correct}/${r.total} (${(100 * r.correct / r.total).toFixed(0)}%)`);
  }

  // What if we take ANY-CORRECT (ensemble)?
  // We can't easily do this here but the idea is: if ANY strategy gets it right, count it
  console.log('\n(Ensemble = if ANY strategy correct, would be higher)\n');
}

main().catch(console.error);
