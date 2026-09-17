import type { AcousticPattern } from '@delisp/dsp';
import type { LispPattern } from './db';

/** A single signal's opinion. `null` means it abstained. */
export type Vote = 'frontal' | 'lateral' | 'mixed' | null;

export interface SelfReport {
  /** Mirror test: is the tongue tip visible between the teeth? */
  tongueVisible: boolean | null;
  /** Straw test: is the air escaping at the corners rather than the centre? */
  airAtCorners: boolean | null;
}

export interface DiagnosticVotes {
  acoustic: Vote;
  selfReport: Vote;
  minimalPair: Vote;
}

export interface DiagnosticResult {
  pattern: LispPattern;
  votes: DiagnosticVotes;
  /** How many of the three signals actually had an opinion. */
  signalCount: number;
  confidence: 'low' | 'moderate';
}

/** Shown with every diagnostic result, without exception (spec §3.4). */
export const DIAGNOSTIC_DISCLAIMER =
  'This is a guess from acoustics and your answers. One session with a speech-language pathologist will confirm placement.';

/**
 * A clear /s/ has nothing to diagnose, and a /ʃ/-like centroid says the sound
 * has drifted backwards rather than which lisp pattern produced it — both
 * abstain rather than guess.
 */
export function acousticVote(pattern: AcousticPattern): Vote {
  switch (pattern) {
    case 'frontal':
      return 'frontal';
    case 'lateral':
      return 'lateral';
    default:
      return null;
  }
}

export function selfReportVote(report: SelfReport): Vote {
  const frontal = report.tongueVisible === true;
  const lateral = report.airAtCorners === true;
  if (frontal && lateral) return 'mixed';
  if (frontal) return 'frontal';
  if (lateral) return 'lateral';
  return null;
}

/**
 * Majority vote across the signals (spec §3.4). Phase 2 has two of the three:
 * the minimal-pair test needs word-level transcription and arrives in Phase 3,
 * so it is accepted here but normally absent.
 */
export function classifyPattern(input: {
  acoustic: AcousticPattern;
  selfReport: SelfReport;
  minimalPair?: Vote;
}): DiagnosticResult {
  const votes: DiagnosticVotes = {
    acoustic: acousticVote(input.acoustic),
    selfReport: selfReportVote(input.selfReport),
    minimalPair: input.minimalPair ?? null,
  };

  let frontal = 0;
  let lateral = 0;
  let signalCount = 0;
  for (const vote of Object.values(votes)) {
    if (vote === null) continue;
    signalCount++;
    if (vote === 'frontal' || vote === 'mixed') frontal++;
    if (vote === 'lateral' || vote === 'mixed') lateral++;
  }

  let pattern: LispPattern;
  if (frontal === 0 && lateral === 0) pattern = 'unknown';
  else if (frontal > lateral) pattern = 'frontal';
  else if (lateral > frontal) pattern = 'lateral';
  else pattern = 'mixed';

  return {
    pattern,
    votes,
    signalCount,
    confidence: signalCount >= 2 ? 'moderate' : 'low',
  };
}

export function patternLabel(pattern: LispPattern): string {
  switch (pattern) {
    case 'frontal':
      return 'Frontal / interdental';
    case 'lateral':
      return 'Lateral';
    case 'mixed':
      return 'Mixed';
    default:
      return 'Not established';
  }
}
