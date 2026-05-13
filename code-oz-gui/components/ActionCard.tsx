'use client';

import React from 'react';
import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: 'emerald' | 'zinc' | 'gold' | 'execute' | 'saved';
  disabled?: boolean;
}

export default function ActionCard({ 
  title, 
  description, 
  icon: Icon, 
  onClick, 
  variant = 'zinc',
  disabled 
}: ActionCardProps) {
  const variants = {
    emerald: 'border-white/20 hover:border-emerald-500 bg-transparent hover:bg-emerald-500/5 text-white',
    zinc: 'border-white/20 hover:border-white bg-transparent text-white/70 hover:text-white',
    gold: 'border-white/20 hover:border-amber-500 bg-transparent hover:bg-amber-500/5 text-white',
    execute: 'bg-white text-black border-white hover:bg-emerald-400',
    saved: 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400',
  };

  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "flex flex-col items-start p-6 border transition-all text-left group gap-4 min-h-[140px]",
        variants[variant],
        disabled && "opacity-20 cursor-not-allowed grayscale"
      )}
    >
      <div className={cn(
        "text-[10px] uppercase tracking-[0.2em] font-bold mb-auto",
        variant === 'execute' ? "text-black/60" : "text-white/40"
      )}>
        {title}
      </div>
      
      <div className="flex items-center justify-between w-full">
        <span className="text-xl font-bold tracking-tight uppercase">OZ {title.split(' ')[0]}</span>
        <Icon className={cn("w-5 h-5 opacity-40 group-hover:opacity-100 transition-opacity")} />
      </div>
    </motion.button>
  );
}
