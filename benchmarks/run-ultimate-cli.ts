#!/usr/bin/env tsx
/**
 * ULTIMATE HYBRID using Claude Code CLI subscription ($0 cost).
 * Same architecture as run-ultimate.ts but uses `claude --print` instead of API.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, '.tmp-prompt.txt');
const MODEL = process.argv[2] || 'sonnet';

function llm(prompt: string): string {
  try {
    writeFileSync(TMP, prompt);
    const env = { ...process.env };
    delete env['CLAUDECODE'];
    const result = execSync(
      `claude --print --model ${MODEL} < "${TMP.replace(/\\/g, '/')}"`,
      { timeout: 180000, maxBuffer: 2 * 1024 * 1024, shell: 'bash', env }
    );
    return result.toString().trim();
  } catch (e) {
    return `ERROR: ${(e as Error).message.slice(0, 80)}`;
  }
}

function fullText(sessions: string[]): string {
  return sessions.map((s, i) => `=== Session ${i + 1} ===\n${s}`).join('\n\n');
}

// ── TEMPORAL: Agentic decomposition ──────────────────────────

function answerTemporal(sessions: string[], question: string): string {
  const plan = llm(`Question: "${question}"
What specific information needs to be extracted? Output JSON array: [{"what": "description", "type": "date|duration|number"}]
JSON:`);

  let tasks: any[] = [];
  try { const m = plan.match(/\[[\s\S]*\]/); if (m) tasks = JSON.parse(m[0]); } catch {}
  if (tasks.length === 0) tasks = [{ what: "relevant temporal information", type: "date" }];

  const extractions: string[] = [];
  for (const task of tasks.slice(0, 4)) {
    const result = llm(`Find "${task.what}" in these conversations. Give the EXACT ${task.type}.

${fullText(sessions)}

${task.what}:`);
    extractions.push(`${task.what}: ${result}`);
  }

  return llm(`Using these facts, answer the question. Give ONLY the specific answer.

${extractions.join('\n')}

Question: ${question}
Answer:`);
}

// ── MULTI-SESSION: Two-pass ──────────────────────────────────

function answerMultiSession(sessions: string[], question: string): string {
  const extractions: string[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const result = llm(`Extract EVERY piece of information relevant to: "${question}"
List each item, number, amount. If nothing, say "Nothing."

Session:
${sessions[i]}

Relevant:`);
    extractions.push(`Session ${i + 1}:\n${result}`);
  }

  const result = llm(`Combine findings to answer the question.

${extractions.join('\n\n')}

Question: ${question}

List items, then: FINAL ANSWER: [answer]`);

  const m = result.match(/FINAL ANSWER:\s*(.+)/i);
  return m ? m[1]!.trim() : result.split('\n').pop()?.trim() || result;
}

// ── KNOWLEDGE UPDATE: Verbose monolithic ─────────────────────

function answerUpdate(sessions: string[], question: string): string {
  return llm(`You are answering about the user's CURRENT state, which may have been updated.
Read ALL sessions. Look for UPDATED or CORRECTED information. Use MOST RECENT value.
Give ONLY the current/latest answer.

${fullText(sessions)}

Question: ${question}
Answer:`);
}

// ── PREFERENCE: Meta-format ──────────────────────────────────

function answerPreference(sessions: string[], question: string): string {
  return llm(`Read the conversation. Describe what response the user would prefer.
CRITICAL: MUST start with "The user would prefer" — describe TYPE of response, NOT actual content.

Example Q: "What music recommendations would I like?"
Example A: "The user would prefer recommendations for indie rock, particularly artists similar to Radiohead."

Example Q: "Can you suggest programming resources?"
Example A: "The user would prefer resources focused on advanced Python development, with code examples."

${fullText(sessions)}

Question: ${question}
Answer (MUST start with "The user would prefer"):`);
}

// ── ASSISTANT / USER: Verbose monolithic ─────────────────────

function answerAssistant(sessions: string[], question: string): string {
  return llm(`Read the session. Answer based on what the AI ASSISTANT said or recommended.
Give ONLY the specific answer.

${fullText(sessions)}

Question: ${question}
Answer:`);
}

function answerUser(sessions: string[], question: string): string {
  return llm(`Read the session. Answer based on what the USER said about themselves.
Never say "not mentioned" — search harder. Give ONLY the specific answer.

${fullText(sessions)}

Question: ${question}
Answer:`);
}

// ── Judge ────────────────────────────────────────────────────

function judge(question: string, generated: string, gold: string): boolean {
  const result = llm(`Does the answer convey same core info as gold? Numbers must match. Yes/no must agree. Answer "yes" or "no".
Q: ${question}
Generated: ${generated.slice(0, 600)}
Gold: ${gold}
Verdict:`);
  return result.toLowerCase().startsWith('yes');
}

// ── Router + Main ────────────────────────────────────────────

const ROUTER: Record<string, (s: string[], q: string) => string> = {
  'temporal-reasoning': answerTemporal,
  'multi-session': answerMultiSession,
  'knowledge-update': answerUpdate,
  'single-session-preference': answerPreference,
  'single-session-assistant': answerAssistant,
  'single-session-user': answerUser,
};

const dataPath = resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json');
const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as any[];

const LIMIT = parseInt(process.argv[3] || '48');
const types: Record<string, any[]> = {};
for (const d of data) { if (!types[d.question_type]) types[d.question_type] = []; types[d.question_type].push(d); }
const sample: any[] = [];
const perType = Math.ceil(LIMIT / Object.keys(types).length);
for (const [, items] of Object.entries(types)) { sample.push(...items.slice(0, perType)); }

console.log(`\n=== ULTIMATE HYBRID CLI (${sample.length}q, model: ${MODEL}) ===`);
console.log(`Using Claude Code subscription ($0 cost)\n`);

let correct = 0, total = 0;
const typeResults: Record<string, { total: number; correct: number }> = {};

for (const item of sample) {
  total++;
  if (!typeResults[item.question_type]) typeResults[item.question_type] = { total: 0, correct: 0 };
  typeResults[item.question_type].total++;

  const sessions: string[] = item.haystack_sessions.map((s: any) =>
    typeof s === 'string' ? s : Array.isArray(s) ? s.map((t: any) => typeof t === 'string' ? t : (t.content || t.text || '')).join(' ') : JSON.stringify(s)
  );

  const handler = ROUTER[item.question_type] || answerUser;

  try {
    const answer = handler(sessions, item.question);
    const isCorrect = judge(item.question, answer, String(item.answer));
    if (isCorrect) { correct++; typeResults[item.question_type].correct++; }
  } catch (e) {
    console.log(`Error: ${(e as Error).message.slice(0, 80)}`);
  }

  if (total % 10 === 0) {
    console.log(`  ${total}/${sample.length}: ${(100 * correct / total).toFixed(0)}%`);
  }
}

console.log(`\n=== RESULTS ===`);
console.log(`Total: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%)`);
for (const [type, res] of Object.entries(typeResults)) {
  console.log(`  ${type}: ${res.correct}/${res.total} (${(100 * res.correct / res.total).toFixed(0)}%)`);
}
console.log(`\nModel: ${MODEL} | Cost: $0 (subscription)`);
console.log(`Targets: 85.2% (Supermemory) | 99% (ASMR)`);
