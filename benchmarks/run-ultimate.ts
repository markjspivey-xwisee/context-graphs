#!/usr/bin/env tsx
/**
 * ULTIMATE HYBRID: best approach per question type.
 *
 * temporal → AGENTIC (decompose into extract_date + compute)
 * multi-session → TWO-PASS (extract per session → aggregate)
 * knowledge-update → VERBOSE MONOLITHIC (full sessions, latest value)
 * preference → META-FORMAT (few-shot "The user would prefer...")
 * assistant → VERBOSE MONOLITHIC (full sessions, what assistant said)
 * user → VERBOSE MONOLITHIC (full sessions, user personal info)
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env['ANTHROPIC_API_KEY'];
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY'); process.exit(1); }

const anthropic = new Anthropic({ apiKey: API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

async function llm(prompt: string, maxTokens = 500): Promise<string> {
  const resp = await anthropic.messages.create({
    model: MODEL, max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.content[0].type === 'text' ? resp.content[0].text : '';
}

function fullText(sessions: string[]): string {
  return sessions.map((s, i) => `=== Session ${i + 1} ===\n${s}`).join('\n\n');
}

// ── TEMPORAL: Agentic decomposition (100% on 48q) ────────────

async function answerTemporal(sessions: string[], question: string): Promise<string> {
  // Step 1: Plan
  const plan = await llm(`Question: "${question}"

What specific information needs to be extracted to answer this? Output a JSON array of extraction tasks.
Each task: {"what": "description", "type": "date|duration|event|number"}
Example: [{"what": "date of car purchase", "type": "date"}, {"what": "date of first service", "type": "date"}]

JSON:`, 300);

  let tasks: any[] = [];
  try { const m = plan.match(/\[[\s\S]*\]/); if (m) tasks = JSON.parse(m[0]); } catch {}
  if (tasks.length === 0) tasks = [{ what: "relevant temporal information", type: "date" }];

  // Step 2: Extract each piece from ALL sessions
  const extractions: string[] = [];
  for (const task of tasks.slice(0, 4)) {
    const result = await llm(`Find "${task.what}" in these conversations. Give the EXACT ${task.type} (date, time, duration, or number). If multiple, list all.

${fullText(sessions)}

${task.what}:`, 200);
    extractions.push(`${task.what}: ${result}`);
  }

  // Step 3: Compute answer from extractions
  return llm(`Using these extracted facts, answer the question. Give ONLY the specific answer.

${extractions.join('\n')}

Question: ${question}
Answer:`, 200);
}

// ── MULTI-SESSION: Two-pass (79% on 402q) ────────────────────

async function answerMultiSession(sessions: string[], question: string): Promise<string> {
  const extractions: string[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const result = await llm(`Extract EVERY piece of information relevant to: "${question}"
List each item, number, amount, or fact. Be exhaustive.
If nothing relevant, say "Nothing."

Session:
${sessions[i]}

Relevant:`, 500);
    extractions.push(`Session ${i + 1}:\n${result}`);
  }

  const result = await llm(`Combine all findings to answer the question.

${extractions.join('\n\n')}

Question: ${question}

List every item found, then compute the answer.
End with: FINAL ANSWER: [your answer]`, 500);

  const m = result.match(/FINAL ANSWER:\s*(.+)/i);
  return m ? m[1]!.trim() : result.split('\n').pop()?.trim() || result;
}

// ── KNOWLEDGE UPDATE: Verbose monolithic (97% on 200q) ───────

async function answerUpdate(sessions: string[], question: string): Promise<string> {
  return llm(`You are answering a question about the user's CURRENT state, which may have been updated over time.

INSTRUCTIONS:
- Read ALL sessions completely
- Look for information that was UPDATED or CORRECTED later
- If there are contradictions, use the MOST RECENT information
- For "do I still" — check if the status changed
- For "how many now" — check if the count was updated
- Give ONLY the current/latest answer

CONVERSATION HISTORY:
${fullText(sessions)}

Question: ${question}

Answer:`, 400);
}

// ── PREFERENCE: Meta-format with examples (80% on 200q) ──────

async function answerPreference(sessions: string[], question: string): Promise<string> {
  return llm(`Read the conversation. Based on the user's stated preferences, interests, expertise, and context, describe what kind of response they would want.

CRITICAL FORMAT: Start with "The user would prefer" and describe the TYPE of response.

Example: "The user would prefer recommendations for indie rock music, particularly artists similar to Radiohead, with links to streaming platforms."
Example: "The user would prefer advanced Python resources focused on machine learning, with code examples rather than theory."

${fullText(sessions)}

Question: ${question}

Answer (start with "The user would prefer"):`, 400);
}

// ── ASSISTANT: Verbose monolithic (100% on optimized) ────────

async function answerAssistant(sessions: string[], question: string): Promise<string> {
  return llm(`Read the session. Answer based on what the AI ASSISTANT said, suggested, recommended, or provided.
Give ONLY the specific answer.

${fullText(sessions)}

Question: ${question}

Answer:`, 400);
}

// ── USER: Verbose monolithic (94%) ───────────────────────────

async function answerUser(sessions: string[], question: string): Promise<string> {
  return llm(`Read the session carefully. Answer based on what the USER said about themselves.
Focus on personal details, habits, experiences, possessions, relationships.
Never say "not mentioned" — search the ENTIRE session.
Give ONLY the specific answer.

${fullText(sessions)}

Question: ${question}

Answer:`, 400);
}

// ── Judge ────────────────────────────────────────────────────

async function judge(question: string, generated: string, gold: string): Promise<boolean> {
  const resp = await llm(`Does the generated answer convey the same core information as the gold?
Numbers must match. Yes/no must agree. Key facts must match. Preferences must align.
Answer "yes" or "no" then briefly why.

Q: ${question}
Generated: ${generated.slice(0, 600)}
Gold: ${gold}

Verdict:`, 30);
  return resp.toLowerCase().startsWith('yes');
}

// ── Router ───────────────────────────────────────────────────

const ROUTER: Record<string, (s: string[], q: string) => Promise<string>> = {
  'temporal-reasoning': answerTemporal,
  'multi-session': answerMultiSession,
  'knowledge-update': answerUpdate,
  'single-session-preference': answerPreference,
  'single-session-assistant': answerAssistant,
  'single-session-user': answerUser,
};

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const dataPath = resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as any[];

  const LIMIT = parseInt(process.argv[2] || '200');

  const types: Record<string, any[]> = {};
  for (const d of data) { if (!types[d.question_type]) types[d.question_type] = []; types[d.question_type].push(d); }
  const sample: any[] = [];
  const perType = Math.ceil(LIMIT / Object.keys(types).length);
  for (const [, items] of Object.entries(types)) { sample.push(...items.slice(0, perType)); }

  console.log(`\n=== ULTIMATE HYBRID (${sample.length}q) ===`);
  console.log(`temporal → AGENTIC | multi → TWO-PASS | update → VERBOSE`);
  console.log(`preference → META-FORMAT | assistant/user → VERBOSE\n`);

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
      const answer = await handler(sessions, item.question);
      const isCorrect = await judge(item.question, answer, String(item.answer));
      if (isCorrect) { correct++; typeResults[item.question_type].correct++; }
    } catch (e) {
      console.log(`Error: ${(e as Error).message.slice(0, 80)}`);
    }

    if (total % 20 === 0) {
      console.log(`  ${total}/${sample.length}: ${(100 * correct / total).toFixed(0)}%`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%)\n`);
  for (const [type, res] of Object.entries(typeResults)) {
    console.log(`  ${type}: ${res.correct}/${res.total} (${(100 * res.correct / res.total).toFixed(0)}%)`);
  }
  console.log(`\nTargets: 85.2% (Supermemory) | 99% (ASMR)`);
}

main().catch(console.error);
