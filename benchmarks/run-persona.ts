#!/usr/bin/env tsx
/**
 * PERSONA approach: Use system prompt to give the LLM a specialized persona
 * that's exceptionally good at reading conversations and extracting facts.
 *
 * The idea: instead of complex multi-step pipelines, make the SINGLE call
 * better by giving the LLM the right "mindset" via system prompt.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! });
const MODEL = 'claude-sonnet-4-20250514';

// The SYSTEM prompt gives the LLM a persistent persona
const SYSTEM_PROMPT = `You are an expert memory analyst with perfect recall. Your job is to read conversation histories and answer questions about them with 100% accuracy.

CRITICAL RULES:
1. Read EVERY word of EVERY session. The answer is ALWAYS in the text — find it.
2. Never say "not mentioned" or "not specified" — the answer IS there, search harder.
3. For numbers: count carefully, list each item, then give the total.
4. For dates: find exact dates, calculate differences precisely.
5. For updates: information may change over time — always use the LATEST value.
6. For preferences: describe what KIND of response the user would want, starting with "The user would prefer..."
7. Be concise — give ONLY the specific answer unless the question requires explanation.
8. When counting across multiple sessions, go through EACH session and list items before counting.`;

async function answer(sessions: string[], question: string, qtype: string): Promise<string> {
  const ft = sessions.map((s, i) => `=== Session ${i + 1} ===\n${s}`).join('\n\n');

  const typeHint: Record<string, string> = {
    'temporal-reasoning': '\n\n[TEMPORAL QUESTION — find dates, calculate differences or ordering]',
    'multi-session': '\n\n[MULTI-SESSION QUESTION — combine information from ALL sessions. List items from each session, then aggregate]',
    'knowledge-update': '\n\n[UPDATE QUESTION — find the MOST RECENT/LATEST value. Information may have been updated]',
    'single-session-preference': '\n\n[PREFERENCE QUESTION — describe what the user would prefer. Start with "The user would prefer..."]',
    'single-session-assistant': '\n\n[ASSISTANT QUESTION — what did the AI assistant say or recommend?]',
    'single-session-user': '\n\n[USER QUESTION — what did the user say about themselves?]',
  };

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${ft}${typeHint[qtype] || ''}\n\nQuestion: ${question}\n\nAnswer:` }],
  });
  return resp.content[0].type === 'text' ? resp.content[0].text : '';
}

async function judge(q: string, gen: string, gold: string, qtype: string): Promise<boolean> {
  const prefExtra = qtype === 'single-session-preference'
    ? '\nFor preferences: same general direction counts as correct.'
    : '';
  const v = await anthropic.messages.create({
    model: MODEL, max_tokens: 10,
    messages: [{ role: 'user', content: `Same core info? Numbers match? Yes/no agree? Just "yes" or "no".${prefExtra}\nQ: ${q}\nGen: ${gen.slice(0, 600)}\nGold: ${gold}\nCorrect?` }],
  });
  const text = v.content[0].type === 'text' ? v.content[0].text : '';
  return text.toLowerCase().replace(/[*"'\s]/g, '').startsWith('yes');
}

const data = JSON.parse(readFileSync(resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json'), 'utf-8'));
const LIMIT = parseInt(process.argv[2] || '48');
const types: Record<string, any[]> = {};
for (const d of data) { if (!types[d.question_type]) types[d.question_type] = []; types[d.question_type].push(d); }
const sample: any[] = [];
const perType = Math.ceil(LIMIT / Object.keys(types).length);
for (const [, items] of Object.entries(types)) sample.push(...items.slice(0, perType));

async function main() {
  console.log(`\n=== PERSONA APPROACH (${sample.length}q) ===`);
  console.log(`Single call with system prompt persona + type hints`);
  console.log(`Only 2 LLM calls per question (answer + judge)\n`);

  let correct = 0, total = 0;
  const typeResults: Record<string, { t: number; c: number }> = {};
  const failures: string[] = [];

  for (const item of sample) {
    total++;
    if (!typeResults[item.question_type]) typeResults[item.question_type] = { t: 0, c: 0 };
    typeResults[item.question_type].t++;

    const sessions: string[] = item.haystack_sessions.map((s: any) =>
      typeof s === 'string' ? s : Array.isArray(s) ? s.map((t: any) => typeof t === 'string' ? t : (t.content || t.text || '')).join(' ') : JSON.stringify(s));

    try {
      const ans = await answer(sessions, item.question, item.question_type);
      const ok = await judge(item.question, ans, String(item.answer), item.question_type);
      if (ok) { correct++; typeResults[item.question_type].c++; }
      else {
        failures.push(`[${item.question_type}] ${item.question.slice(0, 50)}\n  Gold: ${String(item.answer).slice(0, 60)}\n  Ours: ${ans.slice(0, 60)}`);
      }
    } catch (e) { console.log(`Error: ${(e as Error).message.slice(0, 60)}`); }

    if (total % 12 === 0) console.log(`  ${total}/${sample.length}: ${(100 * correct / total).toFixed(0)}%`);
  }

  console.log(`\n=== RESULTS: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%) ===\n`);
  for (const [type, r] of Object.entries(typeResults)) {
    console.log(`  ${type}: ${r.c}/${r.t} (${(100 * r.c / r.t).toFixed(0)}%)`);
  }
  if (failures.length <= 10) {
    console.log(`\nFailures (${failures.length}):\n`);
    for (const f of failures) console.log(f + '\n');
  }
  console.log(`Prior best: 91.7% (48q) | 88.0% (200q) | Only 2 calls/q here`);
}

main().catch(console.error);
