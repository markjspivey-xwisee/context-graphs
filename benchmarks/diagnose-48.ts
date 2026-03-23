#!/usr/bin/env tsx
/**
 * Diagnose EVERY failure on 48q ultimate hybrid.
 * Shows the exact question, gold answer, generated answer, and judge verdict.
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

async function agenticTemporal(sessions: string[], q: string) {
  const plan = await llm(`Question: "${q}"\nWhat info to extract? JSON: [{"what": "desc", "type": "date|duration|number"}]`, 300);
  let tasks: any[] = [];
  try { const m = plan.match(/\[[\s\S]*\]/); if (m) tasks = JSON.parse(m[0]); } catch {}
  if (!tasks.length) tasks = [{ what: 'temporal info', type: 'date' }];
  const exts: string[] = [];
  for (const t of tasks.slice(0, 4)) {
    const r = await llm(`Find "${t.what}" exactly. Give EXACT ${t.type}.\n\n${ft(sessions)}\n\n${t.what}:`, 200);
    exts.push(`${t.what}: ${r}`);
  }
  return llm(`From these facts, answer. ONLY the specific answer.\n\n${exts.join('\n')}\n\nQ: ${q}\nA:`, 200);
}

async function twoPass(sessions: string[], q: string) {
  const exts: string[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const r = await llm(`Extract EVERY fact relevant to: "${q}"\nList each item/number. If nothing, say Nothing.\n\nSession:\n${sessions[i]}\n\nRelevant:`, 500);
    exts.push(`Session ${i + 1}:\n${r}`);
  }
  const r = await llm(`Combine. List items, then FINAL ANSWER: [answer]\n\n${exts.join('\n\n')}\n\nQ: ${q}\nFINAL ANSWER:`, 500);
  const m = r.match(/FINAL ANSWER:\s*(.+)/i);
  return m ? m[1]!.trim() : r.split('\n').pop()?.trim() || r;
}

const data = JSON.parse(readFileSync(resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json'), 'utf-8'));
const types: Record<string, any[]> = {};
for (const d of data) { if (!types[d.question_type]) types[d.question_type] = []; types[d.question_type].push(d); }
const sample: any[] = [];
for (const [, items] of Object.entries(types)) sample.push(...items.slice(0, 8));

async function main() {
  let correct = 0, total = 0;
  const failures: string[] = [];
  const typeResults: Record<string, { t: number; c: number }> = {};

  for (const item of sample) {
    total++;
    if (!typeResults[item.question_type]) typeResults[item.question_type] = { t: 0, c: 0 };
    typeResults[item.question_type].t++;

    const sessions: string[] = item.haystack_sessions.map((s: any) =>
      typeof s === 'string' ? s : Array.isArray(s) ? s.map((t: any) => typeof t === 'string' ? t : (t.content || t.text || '')).join(' ') : JSON.stringify(s));

    let answer: string;
    if (item.question_type === 'temporal-reasoning') {
      answer = await agenticTemporal(sessions, item.question);
    } else if (item.question_type === 'multi-session') {
      answer = await twoPass(sessions, item.question);
    } else if (item.question_type === 'single-session-preference') {
      answer = await llm(`Read the conversation carefully. Describe what kind of response the user would prefer.

CRITICAL FORMAT: Your answer MUST start with "The user would prefer" and describe the TYPE of response they want, NOT the actual content.

Example question: "What kind of music recommendations would I like?"
Example answer: "The user would prefer recommendations for indie rock and alternative music, particularly artists similar to Radiohead and Arctic Monkeys, as they mentioned these as their favorites."

Example question: "Can you suggest some programming resources?"
Example answer: "The user would prefer resources focused on advanced Python development, particularly machine learning libraries like TensorFlow, since they mentioned being an experienced Python developer working on ML projects."

${ft(sessions)}

Question: ${item.question}

Answer (MUST start with "The user would prefer"):`, 400);
    } else if (item.question_type === 'knowledge-update') {
      answer = await llm(`You are answering a question about the user's CURRENT state, which may have been updated over time.

INSTRUCTIONS:
- Read ALL sessions completely
- Look for information that was UPDATED or CORRECTED later in the conversation
- If there are contradictions between sessions, use the MOST RECENT information
- For "do I still" or "am I still" — check if the status changed
- For "how many now" — check if the count was updated
- Give ONLY the current/latest answer

CONVERSATION HISTORY:
${ft(sessions)}

Question: ${item.question}

Answer:`, 400);
    } else {
      answer = await llm(`Read the session carefully. Answer based on what was discussed.
Never say "not mentioned" — search the ENTIRE text.
Give ONLY the specific answer.

${ft(sessions)}

Question: ${item.question}

Answer:`, 400);
    }

    const v = await llm(`Does the generated answer convey the same core information as the gold?
Numbers must match. Yes/no must agree. Key facts must match.
For "The user would prefer..." answers, the described preferences must align.
Answer "yes" or "no", then briefly why.

Q: ${item.question}
Generated: ${answer.slice(0, 600)}
Gold: ${item.answer}

Verdict:`, 40);
    const ok = v.toLowerCase().startsWith('yes');
    if (ok) {
      correct++;
      typeResults[item.question_type].c++;
    } else {
      failures.push(`[${item.question_type}]\n  Q: ${item.question}\n  Gold: ${String(item.answer).slice(0, 200)}\n  Ours: ${answer.slice(0, 200)}\n  Judge: ${v.slice(0, 100)}`);
    }

    if (total % 12 === 0) console.log(`  ${total}/${sample.length}: ${(100 * correct / total).toFixed(0)}%`);
  }

  console.log(`\nScore: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%)\n`);
  for (const [type, r] of Object.entries(typeResults)) {
    console.log(`  ${type}: ${r.c}/${r.t} (${(100 * r.c / r.t).toFixed(0)}%)`);
  }
  console.log(`\n=== ALL ${failures.length} FAILURES ===\n`);
  for (const f of failures) console.log(f + '\n');
}

main().catch(console.error);
