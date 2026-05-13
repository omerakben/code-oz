'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  id: string;
  type: 'command' | 'output' | 'error' | 'success';
  content: string;
  timestamp: Date;
}

export default function Terminal({ commands }: { commands: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [commands]);

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-sm overflow-hidden flex flex-col h-[400px] relative">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-white/20" />
          <div className="w-2 h-2 rounded-full bg-white/20" />
          <div className="w-2 h-2 rounded-full bg-white/20" />
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/40">Console Output - Live Stream</span>
      </div>

      {/* Logs */}
      <div 
        ref={scrollRef}
        className="flex-1 p-6 font-mono text-xs leading-relaxed overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
      >
        <AnimatePresence initial={false}>
          {commands.length === 0 ? (
            <div className="text-white/20 italic">_ System idle. Waiting for connection...</div>
          ) : (
            commands.map((log) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className="mb-2 flex gap-3"
              >
                <span className="text-emerald-500/50 shrink-0">
                  [{log.timestamp.toLocaleTimeString([], { hour12: false })}]
                </span>
                
                <div className="flex-1">
                  {log.type === 'command' && (
                    <span className="text-white/40 italic">oz:{log.content}</span>
                  )}
                  {log.type === 'output' && (
                    <span className="text-white/70">{log.content}</span>
                  )}
                  {log.type === 'error' && (
                    <span className="bg-red-500/10 text-red-400 px-1 py-0.5">ERROR: {log.content}</span>
                  )}
                  {log.type === 'success' && (
                    <span className="bg-emerald-500/10 text-emerald-400 px-1 py-0.5 tracking-tight uppercase font-bold text-[10px]">SUCCESS</span>
                  )}
                  {log.type === 'success' && <span className="ml-2 text-white/70">{log.content}</span>}
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
        <div className="pt-2 text-emerald-400 border-l-2 border-emerald-400 pl-2 animate-pulse h-4">_</div>
      </div>
    </div>
  );
}
