'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Panel, Tag } from '@/components/Panels';
import { COURSE, Lesson } from '@/lib/curriculum';
import { STRATEGIES } from '@/lib/strategies';

export default function CoursePage() {
  const [active, setActive] = useState<string | null>(null);
  const activeLesson = active ? COURSE.find(l => l.slug === active) : null;

  return (
    <div className="space-y-4 max-w-[1100px]">
      <Panel title="~/course">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--green)] glow">Options · The Full Course</h1>
            <p className="text-[var(--fg-dim)] mt-1 leading-relaxed text-sm">
              Ten lessons covering everything from "what is an option" to "where Black-Scholes breaks."
              Click any lesson to expand. Estimated total time: <span className="text-[var(--fg)] font-semibold">~80 minutes</span>.
            </p>
          </div>
          <Link href="/learn" className="btn-ghost px-4 py-2 rounded-[var(--radius-sm)] text-sm border border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--green)] hover:border-[var(--green-dim)]">
            ← back to strategies
          </Link>
        </div>
      </Panel>

      {!activeLesson ? (
        <div className="space-y-3">
          {COURSE.map((lesson, i) => (
            <LessonCard
              key={lesson.slug}
              lesson={lesson}
              index={i}
              onClick={() => setActive(lesson.slug)}
            />
          ))}
        </div>
      ) : (
        <LessonView
          lesson={activeLesson}
          onBack={() => setActive(null)}
          onPrev={activeLesson.number > 1 ? () => setActive(COURSE[activeLesson.number - 2].slug) : undefined}
          onNext={activeLesson.number < COURSE.length ? () => setActive(COURSE[activeLesson.number].slug) : undefined}
        />
      )}
    </div>
  );
}

function LessonCard({ lesson, index, onClick }: { lesson: Lesson; index: number; onClick: () => void }) {
  const related = lesson.relatedStrategy ? STRATEGIES[lesson.relatedStrategy] : null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-[var(--radius)] border border-[var(--border)] bg-gradient-to-br from-[var(--bg-2)] to-[var(--bg)] p-5 hover:border-[var(--green-dim)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all duration-200"
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--green-dim)] to-[var(--green-faint)] flex items-center justify-center text-[#06180c] font-bold text-lg shadow-[0_0_12px_rgba(34,197,94,0.25)]">
          {lesson.number.toString().padStart(2, '0')}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-[var(--fg)]">{lesson.title}</h3>
            <span className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">~{lesson.estimatedMinutes} min</span>
          </div>
          <p className="text-sm text-[var(--fg-dim)] mt-1">{lesson.subtitle}</p>
          <div className="flex gap-2 mt-3 flex-wrap">
            {lesson.keyTakeaways.slice(0, 2).map((t, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--fg-faint)]">
                {t.length > 50 ? t.slice(0, 47) + '…' : t}
              </span>
            ))}
            {related && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--green-dim)] bg-[var(--green-faint)] text-[var(--green)]">
                {related.meta.emoji} {related.meta.name}
              </span>
            )}
          </div>
        </div>
        <span className="text-[var(--green)] text-2xl">→</span>
      </div>
    </button>
  );
}

function LessonView({ lesson, onBack, onPrev, onNext }: {
  lesson: Lesson;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const related = lesson.relatedStrategy ? STRATEGIES[lesson.relatedStrategy] : null;
  const progress = ((lesson.number - 1) / COURSE.length) * 100;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="h-1 rounded-full bg-[var(--bg-3)] overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[var(--green-2)] to-[var(--green)] transition-all" style={{ width: `${progress + (100 / COURSE.length)}%` }} />
      </div>

      <Panel
        title={`~/course · lesson ${lesson.number}`}
        right={
          <div className="flex items-center gap-2">
            <Tag color="dim">~{lesson.estimatedMinutes} min</Tag>
            <button onClick={onBack} className="text-xs text-[var(--fg-dim)] hover:text-[var(--green)]">← all lessons</button>
          </div>
        }
      >
        <h1 className="text-3xl font-bold text-[var(--green)] glow mb-1">{lesson.title}</h1>
        <p className="text-[var(--fg-dim)]">{lesson.subtitle}</p>
      </Panel>

      {/* Body */}
      <Panel title="~/read">
        <article className="prose-condor space-y-5 max-w-none">
          {lesson.paragraphs.map((p, i) => (
            <div key={i}>
              {p.heading && (
                <h2 className="text-base font-bold text-[var(--green-2)] mb-2 mt-4 first:mt-0">
                  {p.heading}
                </h2>
              )}
              <p className="text-[var(--fg)] leading-relaxed text-[14px]">{p.body}</p>
            </div>
          ))}
        </article>
      </Panel>

      {/* Key takeaways */}
      <Panel title="~/key_takeaways">
        <ul className="space-y-2">
          {lesson.keyTakeaways.map((t, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="text-[var(--green)] mt-0.5 flex-shrink-0">▸</span>
              <span className="text-[var(--fg)] text-sm leading-relaxed">{t}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Related strategy */}
      {related && (
        <Panel title="~/try_it">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{related.meta.emoji}</span>
              <div>
                <div className="font-bold text-[var(--fg)]">{related.meta.name}</div>
                <div className="text-xs text-[var(--fg-dim)]">see this strategy in action →</div>
              </div>
            </div>
            <Link
              href={`/trade?strategy=${related.meta.id}`}
              className="btn-primary px-5 py-2 rounded-[var(--radius-sm)] text-sm"
            >
              analyze in /trade →
            </Link>
          </div>
        </Panel>
      )}

      {/* Navigation */}
      <div className="flex justify-between gap-3">
        {onPrev ? (
          <button
            onClick={onPrev}
            className="flex-1 text-left rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-2)]/40 px-4 py-3 hover:border-[var(--border-bright)] transition"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-faint)]">← previous</div>
            <div className="text-sm font-bold text-[var(--fg)] mt-0.5">{COURSE[lesson.number - 2]?.title}</div>
          </button>
        ) : <div className="flex-1" />}
        {onNext ? (
          <button
            onClick={onNext}
            className="flex-1 text-right rounded-[var(--radius)] border border-[var(--green-dim)] bg-[var(--green-faint)]/30 px-4 py-3 hover:bg-[var(--green-faint)] transition"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--green-2)]">next →</div>
            <div className="text-sm font-bold text-[var(--green)] mt-0.5">{COURSE[lesson.number]?.title}</div>
          </button>
        ) : (
          <button
            onClick={onBack}
            className="flex-1 text-right rounded-[var(--radius)] border border-[var(--green-dim)] bg-[var(--green-faint)]/30 px-4 py-3 hover:bg-[var(--green-faint)] transition"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--green-2)]">finish</div>
            <div className="text-sm font-bold text-[var(--green)] mt-0.5">🎓 course complete</div>
          </button>
        )}
      </div>
    </div>
  );
}