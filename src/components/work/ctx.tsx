'use client';
import { createContext, useContext } from 'react';
import type { Derived, Rule, LintIssue } from '@/engine';
import type { Profile } from '@/config/profiles';
import type { Evidence, Project } from '@/lib/project';
import type { Update } from '@/lib/pipeline';

export interface WorkCtx {
  p: Project;
  update: Update;
  before: Rule | null; // 개정: 현행 규정
  d: Derived | null; // 개정: 산출물
  enactRule: Rule | null;
  enactLint: LintIssue[];
  prof: Profile;
  openEvidence: (e: Evidence | string) => void;
  toast: (msg: string, undo?: () => void) => void;
  setTab: (t: 'articles' | 'lint' | 'docs' | 'procedure') => void;
}

export const Ctx = createContext<WorkCtx | null>(null);
export function useWork(): WorkCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('작업실 밖');
  return v;
}
