#!/usr/bin/env tsx
/**
 * AGENTIC COMPREHENSION PIPELINE
 *
 * Instead of "read text → answer question" (one monolithic LLM call),
 * this decomposes comprehension into TYPED OPERATIONS (affordances):
 *
 *   1. OBSERVE: What sessions/data are available?
 *   2. ORIENT: What type of question? What entities? What operations needed?
 *   3. PLAN: Decompose into sub-operations (affordances)
 *   4. EXECUTE: Run each operation (small, focused LLM calls)
 *   5. COMPOSE: Combine results using our algebraic operators
 *
 * Each operation is a specific AFFORDANCE:
 *   - extract_entity(session, entity) → value
 *   - extract_date(session, event) → date
 *   - extract_list(session, category) → items[]
 *   - compare(a, b) → ordering
 *   - compute(operation, values) → result
 *   - find_update(sessions, entity) → latest_value
 *   - describe_preference(session) → preference_description
 *
 * The LLM executes INDIVIDUAL operations, not monolithic comprehension.
 * Composition is structural (our union/intersection operators).
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

// ── Typed Operations (Affordances) ───────────────────────────

async function llm(prompt: string, maxTokens = 500): Promise<string> {
  const resp = await anthropic.messages.create({
    model: MODEL, max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return resp.content[0].type === 'text' ? resp.content[0].text : '';
}

// ORIENT: Decompose the question into a plan of operations
async function orient(question: string, sessionCount: number): Promise<{
  questionType: string;
  plan: string[];
  entities: string[];
}> {
  const resp = await llm(`Analyze this question and create an execution plan.

Question: "${question}"
Number of sessions: ${sessionCount}

Output a JSON object with:
- questionType: "temporal_ordering" | "temporal_duration" | "counting" | "summing" | "comparison" | "preference" | "factual" | "update" | "yes_no"
- plan: array of operation strings, each like:
  - "extract_entity(session_ALL, 'car model')"
  - "extract_date(session_ALL, 'car purchase')"
  - "extract_list(session_ALL, 'items of clothing to pick up')"
  - "find_latest(session_ALL, 'personal best time')"
  - "count_items(results)"
  - "sum_values(results)"
  - "compute_difference(date1, date2)"
  - "compare_dates(event_a, event_b)"
  - "describe_preference(session_ALL)"
- entities: key entities/concepts to search for

JSON:`, 400);

  try {
    const m = resp.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return { questionType: 'factual', plan: ['extract_entity(session_ALL, "answer")'], entities: [] };
}

// EXECUTE: Run a single typed operation against sessions
async function executeOperation(
  op: string,
  sessions: string[],
  question: string,
  priorResults: string[],
): Promise<string> {
  // Parse the operation
  const extractMatch = op.match(/extract_(\w+)\(session_(\w+),\s*'([^']+)'\)/);
  const findLatest = op.match(/find_latest\(session_(\w+),\s*'([^']+)'\)/);
  const countItems = op.match(/count_items/);
  const sumValues = op.match(/sum_values/);
  const computeDiff = op.match(/compute_difference/);
  const compareDates = op.match(/compare_dates/);
  const describePreference = op.match(/describe_preference/);

  if (extractMatch) {
    const [, extractType, sessionTarget, searchFor] = extractMatch;
    const targetSessions = sessionTarget === 'ALL' ? sessions : [sessions[parseInt(sessionTarget) - 1] || ''];

    // Run extraction across ALL targeted sessions in parallel
    const results = await Promise.all(targetSessions.map(async (s, i) => {
      return llm(`From this conversation, extract: ${searchFor}
${extractType === 'list' ? 'List EVERY instance. One per line.' : extractType === 'date' ? 'Give the EXACT date or time.' : 'Give the SPECIFIC value.'}
If not found, say "NOT_FOUND".

Session:
${s}

${searchFor}:`, 300);
    }));

    return results.map((r, i) => `Session ${i + 1}: ${r}`).join('\n');
  }

  if (findLatest) {
    const [, , searchFor] = findLatest;
    // Search all sessions for the entity, return the LATEST value
    const results = await Promise.all(sessions.map(async (s, i) => {
      return llm(`Find the MOST RECENT value of "${searchFor}" in this conversation.
If it was updated or corrected, give the NEW value.
If not mentioned, say "NOT_FOUND".

Session:
${s}

Latest ${searchFor}:`, 200);
    }));
    // Take the last non-NOT_FOUND result
    const found = results.filter(r => !r.includes('NOT_FOUND'));
    return found.length > 0 ? found[found.length - 1]! : 'NOT_FOUND';
  }

  if (countItems || sumValues || computeDiff || compareDates) {
    // Computation over prior results
    return llm(`Given these extracted results, ${op}.

Prior results:
${priorResults.join('\n')}

Original question: ${question}

Compute the answer. Give ONLY the final value (number, date, name, yes/no).

Answer:`, 200);
  }

  if (describePreference) {
    const full = sessions.join('\n\n');
    return llm(`Read this conversation and describe what kind of response the user would prefer.
Start with "The user would prefer" and describe the TYPE/STYLE of response based on their interests, expertise, and preferences.

${full}

The user would prefer`, 400);
  }

  // Fallback: generic extraction
  return llm(`${op}\n\nSessions:\n${sessions.map((s, i) => `=== Session ${i+1} ===\n${s}`).join('\n\n')}\n\nQuestion: ${question}\n\nAnswer:`, 400);
}

// COMPOSE: Combine operation results into final answer
async function compose(
  results: string[],
  question: string,
  questionType: string,
): Promise<string> {
  return llm(`You have the results of multiple extraction operations. Combine them to answer the question.

Operations results:
${results.map((r, i) => `Step ${i + 1}: ${r}`).join('\n\n')}

Question: ${question}
Question type: ${questionType}

Rules:
- For counting: count the distinct items found across all steps
- For summing: add all the numbers found
- For temporal: use the extracted dates to determine ordering or compute differences
- For comparisons: compare the extracted values
- For preferences: start with "The user would prefer..."
- For yes/no: answer Yes or No based on the evidence
- Give ONLY the final answer — a specific number, name, date, or short phrase

Final answer:`, 300);
}

// ── Judge ────────────────────────────────────────────────────

async function judge(question: string, generated: string, gold: string): Promise<boolean> {
  const resp = await llm(`Does the generated answer convey the same core information as the gold?
Numbers must match. Yes/no must agree. Key entities must match. Preferences must align in meaning.
Answer "yes" or "no" then briefly why.

Q: ${question}
Generated: ${generated.slice(0, 600)}
Gold: ${gold}

Verdict:`, 30);
  return resp.toLowerCase().startsWith('yes');
}

// ── Main Pipeline ────────────────────────────────────────────

async function main() {
  const dataPath = resolve(__dirname, 'LongMemEval/data/longmemeval_oracle.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as any[];

  const LIMIT = parseInt(process.argv[2] || '100');

  // Stratified sample
  const types: Record<string, any[]> = {};
  for (const d of data) { if (!types[d.question_type]) types[d.question_type] = []; types[d.question_type].push(d); }
  const sample: any[] = [];
  const perType = Math.ceil(LIMIT / Object.keys(types).length);
  for (const [, items] of Object.entries(types)) { sample.push(...items.slice(0, perType)); }

  console.log(`\n=== AGENTIC COMPREHENSION (${sample.length}q) ===`);
  console.log(`OBSERVE → ORIENT → PLAN → EXECUTE → COMPOSE`);
  console.log(`Each step is a typed affordance, not monolithic comprehension.\n`);

  let correct = 0, total = 0, totalOps = 0;
  const typeResults: Record<string, { total: number; correct: number }> = {};

  for (const item of sample) {
    total++;
    if (!typeResults[item.question_type]) typeResults[item.question_type] = { total: 0, correct: 0 };
    typeResults[item.question_type].total++;

    const sessions: string[] = item.haystack_sessions.map((s: any) =>
      typeof s === 'string' ? s : Array.isArray(s) ? s.map((t: any) => typeof t === 'string' ? t : (t.content || t.text || '')).join(' ') : JSON.stringify(s)
    );

    try {
      // ORIENT: analyze question, create plan
      const plan = await orient(item.question, sessions.length);
      totalOps++;

      // EXECUTE: run each operation in the plan
      const results: string[] = [];
      for (const op of plan.plan.slice(0, 5)) { // max 5 operations
        const result = await executeOperation(op, sessions, item.question, results);
        results.push(`[${op}]: ${result}`);
        totalOps++;
      }

      // COMPOSE: combine results into final answer
      const answer = await compose(results, item.question, plan.questionType);
      totalOps++;

      // JUDGE
      const isCorrect = await judge(item.question, answer, String(item.answer));
      totalOps++;

      if (isCorrect) {
        correct++;
        typeResults[item.question_type].correct++;
      }
    } catch (e) {
      console.log(`Error: ${(e as Error).message.slice(0, 80)}`);
    }

    if (total % 20 === 0) {
      console.log(`  ${total}/${sample.length}: ${(100 * correct / total).toFixed(0)}% (${totalOps} ops, ${(totalOps / total).toFixed(1)} ops/q)`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total: ${correct}/${total} (${(100 * correct / total).toFixed(1)}%)`);
  console.log(`Operations: ${totalOps} (avg ${(totalOps / total).toFixed(1)}/question)\n`);

  for (const [type, res] of Object.entries(typeResults)) {
    console.log(`  ${type}: ${res.correct}/${res.total} (${(100 * res.correct / res.total).toFixed(0)}%)`);
  }

  console.log(`\nComparison:`);
  console.log(`  Prior best (monolithic): 79.9% @ 2.6 calls/q`);
  console.log(`  This (agentic): ${(100 * correct / total).toFixed(1)}% @ ${(totalOps / total).toFixed(1)} ops/q`);
  console.log(`  Supermemory production: 85.2%`);
  console.log(`  Supermemory ASMR: ~99% @ 19 calls/q`);
}

main().catch(console.error);
