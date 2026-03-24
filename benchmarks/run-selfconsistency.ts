#!/usr/bin/env tsx
/**
 * Self-consistency voting: generate 3 answers, take majority.
 * Uses the best strategy per type from run-95.ts but runs each 3 times.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! });
const MODEL = 'claude-sonnet-4-20250514';
const VOTES = 3;

async function llm(prompt: string, mt = 500, temp = 0.7) {
  const r = await anthropic.messages.create({
    model: MODEL, max_tokens: mt, temperature: temp,
    messages: [{ role: 'user', content: prompt }],
  });
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

function ft(sessions: string[]) { return sessions.map((s, i) => `=== Session ${i + 1} ===\n${s}`).join('\n\n'); }

async function judge(q: string, gen: string, gold: string): Promise<boolean> {
  const v = await llm(`Same core info? Numbers match? Just "yes" or "no".\nQ: ${q}\nGen: ${gen.slice(0, 600)}\nGold: ${gold}\nCorrect?`, 10, 0);
  return v.toLowerCase().replace(/[*"'\s]/g, '').startsWith('yes');
}

// Generate answer with the best strategy per type
async function generateAnswer(sessions: string[], question: string, qtype: string, temp: number): Promise<string> {
  if (qtype === 'temporal-reasoning') {
    // TwoPass
    const dates = await llm(`List EVERY date, time, duration in these conversations.\nFormat: "Event: date/time"\n\n${ft(sessions)}\n\nAll temporal facts:`, 1000, temp);
    return llm(`Using these facts, answer. ONLY the specific answer.\n\nTemporal facts:\n${dates}\n\nQ: ${question}\nA:`, 200, temp);
  }
  if (qtype === 'multi-session') {
    const exts: string[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const r = await llm(`Extract EVERY fact relevant to: "${question}"\nList each item/number. If nothing, say Nothing.\n\nSession:\n${sessions[i]}\n\nRelevant:`, 500, temp);
      exts.push(`Session ${i + 1}:\n${r}`);
    }
    const agg = await llm(`Combine. List items, then FINAL ANSWER: [answer]\n\n${exts.join('\n\n')}\n\nQ: ${question}\nFINAL ANSWER:`, 500, temp);
    const m = agg.match(/FINAL ANSWER:\s*(.+)/i);
    return m ? m[1]!.trim() : agg.split('\n').pop()?.trim() || agg;
  }
  if (qtype === 'single-session-preference') {
    return llm(`Read the conversation. MUST start with "The user would prefer". Describe TYPE of response, NOT content.\n\nExample: "The user would prefer recommendations for indie rock, similar to Radiohead."\n\n${ft(sessions)}\n\nQ: ${question}\nAnswer (MUST start with "The user would prefer"):`, 400, temp);
  }
  if (qtype === 'knowledge-update') {
    return llm(`Read ALL sessions. Find MOST RECENT value. Give ONLY the single current answer.\n\n${ft(sessions)}\n\nQ: ${question}\nCurrent answer:`, 100, temp);
  }
  return llm(`Read the session. Never say "not mentioned". Give ONLY the specific answer.\n\n${ft(sessions)}\n\nQ: ${question}\nAnswer:`, 400, temp);
}

const data = JSON.parse(readFileSync(resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json'), 'utf-8'));
const LIMIT = parseInt(process.argv[2] || '48');
const types: Record<string, any[]> = {};
for (const d of data) { if (!types[d.question_type]) types[d.question_type] = []; types[d.question_type].push(d); }
const sample: any[] = [];
const perType = Math.ceil(LIMIT / Object.keys(types).length);
for (const [, items] of Object.entries(types)) sample.push(...items.slice(0, perType));

async function main() {
  console.log(`\n=== SELF-CONSISTENCY VOTING (${sample.length}q, ${VOTES} votes each) ===\n`);

  let correct = 0, total = 0;
  const typeResults: Record<string, { t: number; c: number }> = {};

  for (const item of sample) {
    total++;
    if (!typeResults[item.question_type]) typeResults[item.question_type] = { t: 0, c: 0 };
    typeResults[item.question_type].t++;

    const sessions: string[] = item.haystack_sessions.map((s: any) =>
      typeof s === 'string' ? s : Array.isArray(s) ? s.map((t: any) => typeof t === 'string' ? t : (t.content || t.text || '')).join(' ') : JSON.stringify(s));

    // Generate VOTES answers with different temperatures
    const temps = [0.3, 0.7, 1.0];
    const answers = await Promise.all(
      temps.slice(0, VOTES).map((t, i) => generateAnswer(sessions, item.question, item.question_type, t))
    );

    // Pick best via aggregator
    const best = await llm(`${VOTES} agents independently answered this question. Pick the BEST answer or synthesize the consensus.

Question: ${item.question}

${answers.map((a, i) => `Agent ${i + 1}: ${a.slice(0, 300)}`).join('\n\n')}

Best answer (specific and concise):`, 200, 0);

    const ok = await judge(item.question, best, String(item.answer));
    if (ok) { correct++; typeResults[item.question_type].c++; }

    if (total % 12 === 0) console.log(`  ${total}/${sample.length}: ${(100 * correct / total).toFixed(0)}%`);
  }

  console.log(`\n=== RESULTS: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%) ===\n`);
  for (const [type, r] of Object.entries(typeResults)) {
    console.log(`  ${type}: ${r.c}/${r.t} (${(100 * r.c / r.t).toFixed(0)}%)`);
  }
  console.log(`\nPrior best: 91.7% (48q) | 88.0% (200q)`);
  console.log(`LLM calls: ~${VOTES * 3 + 2} per question (${VOTES} votes + aggregator + judge)`);
}

main().catch(console.error);
