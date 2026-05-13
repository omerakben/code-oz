'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessagesSquare, Send, X } from 'lucide-react';
import type { RunCard } from '@/lib/types';

interface AIHelperProps {
  runId: string;
  card: RunCard;
  currentTab: 'artifact' | 'events' | 'decisions';
}

const PROMPTS: Record<AIHelperProps['currentTab'], readonly string[]> = {
  artifact: ['Explain this in plain English', 'What changes if I approve?', "What's the riskiest hypothesis?"],
  decisions: ['What happens if I approve?', 'What if I ask for revisions?', "What's blocking me from shipping?"],
  events: ['Why did this happen?', 'What did the AI do here?', 'Where should I look next?'],
};

function cardKindLabel(kind: RunCard['kind']): string {
  return kind;
}

export default function AIHelper({ runId, card, currentTab }: AIHelperProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'asking' | 'error' | 'ok'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setInputValue('');
    setAnswer(null);
    setStatus('idle');
    setErrorMessage(null);
    setIsExpanded(false);
  }, [card.id, currentTab]);

  const handlePromptClick = (promptText: string) => {
    setInputValue(promptText);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleSend = async () => {
    const prompt = inputValue.trim();

    if (prompt.length === 0) {
      return;
    }

    setStatus('asking');
    setAnswer(null);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/helper/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          cardId: card.id,
          currentTab,
          prompt,
        }),
      });
      const payload = await response.json().catch(() => null) as unknown;

      if (!response.ok) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string'
            ? payload.detail
            : 'Helper unavailable.';
        throw new Error(detail);
      }

      const nextAnswer =
        payload && typeof payload === 'object' && 'answer' in payload && typeof payload.answer === 'string'
          ? payload.answer
          : '';

      setAnswer(nextAnswer);
      setInputValue('');
      setStatus('ok');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Helper unavailable.');
    }
  };

  const resetAnswer = () => {
    setAnswer(null);
    setStatus('idle');
    setErrorMessage(null);
    setInputValue('');
  };

  return (
    <div className="absolute bottom-4 right-4 z-30">
      <AnimatePresence mode="wait" initial={false}>
        {isExpanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex h-[300px] w-[260px] flex-col border border-white/10 bg-[#0c0c0c] shadow-2xl"
          >
            <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
              <div className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                Ask about this {cardKindLabel(card.kind)}
              </div>
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                aria-label="Close AI helper"
                className="grid h-6 w-6 shrink-0 place-items-center text-white/40 transition-colors hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {status === 'asking' ? (
                <p className="px-3 py-4 text-sm italic text-white/40">Thinking...</p>
              ) : answer ? (
                <div>
                  <p className="whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-white/85">{answer}</p>
                  <button
                    type="button"
                    onClick={resetAnswer}
                    className="px-3 pb-3 text-left text-xs text-white/40 transition-colors hover:text-white/70"
                  >
                    Ask another
                  </button>
                </div>
              ) : (
                <>
                  {status === 'error' ? (
                    <p className="px-3 py-2 text-xs text-red-300">{errorMessage || 'Helper unavailable.'}</p>
                  ) : null}
                  {PROMPTS[currentTab].map((promptText) => (
                    <button
                      key={promptText}
                      type="button"
                      onClick={() => handlePromptClick(promptText)}
                      className="block w-full border-b border-white/[0.04] px-3 py-2 text-left text-xs text-white/65 transition-colors last:border-b-0 hover:text-white"
                    >
                      {promptText}
                    </button>
                  ))}
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-white/10 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="Ask anything about this view..."
                  className="min-h-[40px] max-h-[60px] w-full resize-none bg-transparent text-sm text-white/85 placeholder:text-white/30 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={inputValue.trim().length === 0 || status === 'asking'}
                  aria-label="Send question"
                  className="grid h-8 w-8 shrink-0 place-items-center border border-emerald-500/30 text-emerald-300 transition-colors hover:bg-emerald-500/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="collapsed"
            type="button"
            onClick={() => setIsExpanded(true)}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="inline-flex h-10 cursor-pointer items-center gap-2 border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300 transition-colors hover:bg-emerald-500/[0.08]"
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            Ask
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
