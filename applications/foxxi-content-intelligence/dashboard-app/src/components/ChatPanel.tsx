import React, { useState } from 'react';
import { Card, Button, TextInput, Pill } from './common.js';
import { askCourseQuestion, type AskCourseQuestionResult } from '../interego/client.js';
import type { CourseContent } from '../types.js';

interface ChatTurn {
  question: string;
  result: AskCourseQuestionResult;
  at: string;
}

export function ChatPanel(props: {
  learnerDid: string;
  course: CourseContent;
}) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!question.trim() || loading) return;
    setLoading(true); setError(null);
    try {
      const result = await askCourseQuestion({
        learnerDid: props.learnerDid,
        courseIri: props.course.courseIri,
        question: question.trim(),
        courseContent: props.course,
      });
      setHistory(h => [...h, { question: question.trim(), result, at: new Date().toISOString() }]);
      setQuestion('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      title="Ask a question about this course"
      right={<Pill tone="accent">foxxi.ask_course_question</Pill>}
    >
      <div style={{ marginBottom: 16, color: 'var(--text-dim)', fontSize: 12 }}>
        Honest grounding: answers cite verbatim transcript segments + concept atoms from the course's parsed
        narration. No confabulation — if no atom overlaps the question, the substrate returns honest null
        (the response below will show "I don't have grounding for that").
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <TextInput
          value={question}
          onChange={setQuestion}
          placeholder="e.g., what is handicap?"
          onSubmit={ask}
        />
        <Button primary onClick={ask} disabled={loading || !question.trim()}>
          {loading ? 'Asking…' : 'Ask'}
        </Button>
      </div>

      {error && (
        <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 16 }}>
          ✗ {error}
        </div>
      )}

      {history.length === 0 && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
          Try: "what is handicap?" · "how does the golf develop the handicap reference?"
          · "tell me about course par" · or an off-topic question like "what is photosynthesis?" to see the
          honest-null response.
        </div>
      )}

      {history.slice().reverse().map((turn, i) => (
        <div key={i} style={{
          marginBottom: 14, padding: 12,
          background: 'var(--panel-2)', borderRadius: 6,
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
            You asked · <code>{new Date(turn.at).toLocaleTimeString()}</code>
          </div>
          <div style={{ marginBottom: 12, fontStyle: 'italic' }}>{turn.question}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
            Substrate response:
          </div>
          {!turn.result.grounded || !turn.result.answer ? (
            <div style={{
              padding: 10, background: 'rgba(255,177,85,0.08)',
              border: '1px solid rgba(255,177,85,0.3)',
              borderRadius: 6, fontSize: 13,
            }}>
              <Pill tone="warn">honest no-match</Pill>
              <div style={{ marginTop: 6 }}>
                No transcript segment or concept atom overlaps this question above the substrate's
                minimum threshold. The substrate returned <code>null</code> rather than confabulate an answer.
              </div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 8 }}>
                <Pill tone="good">grounded</Pill> {turn.result.answer.citations.length} citation
                {turn.result.answer.citations.length === 1 ? '' : 's'} · all verbatim
              </div>
              {turn.result.answer.citations.slice(0, 5).map((c, j) => (
                <div key={j} style={{
                  marginBottom: 8, padding: 10,
                  background: 'var(--panel)', borderRadius: 6,
                  borderLeft: '3px solid var(--accent)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                    <code style={{ wordBreak: 'break-all' }}>{c.atomIri}</code>
                  </div>
                  <div style={{ fontSize: 13 }}>
                    "{c.verbatimQuote.length > 320
                      ? c.verbatimQuote.slice(0, 320) + '…'
                      : c.verbatimQuote}"
                  </div>
                </div>
              ))}
              {turn.result.answer.citations.length > 5 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  + {turn.result.answer.citations.length - 5} additional citations (truncated for display)
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
