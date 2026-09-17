import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * D1 schema, spec §4. Single user: `settings` is pinned to one row, and nothing
 * carries a user id — Cloudflare Access is the only tenant boundary.
 */

export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    lispPattern: text('lisp_pattern').notNull().default('unknown'),
    noiseFloor: real('noise_floor'),
    targetCentroid: real('target_centroid'),
    targetRatio: real('target_ratio'),
    tolerance: real('tolerance'),
    feedbackRate: real('feedback_rate').notNull().default(1),
    sampleRate: real('sample_rate'),
    deviceLabel: text('device_label'),
    calibratedAt: text('calibrated_at'),
    diagnosedAt: text('diagnosed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('settings_singleton', sql`${table.id} = 1`)],
);

export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    level: integer('level').notNull(),
    sound: text('sound').notNull(),
    position: text('position'),
    text: text('text').notNull(),
    minimalPair: text('minimal_pair'),
    modelAudioKey: text('model_audio_key'),
    tags: text('tags'),
  },
  (table) => [index('exercises_level_idx').on(table.level)],
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  level: integer('level').notNull(),
  trialCount: integer('trial_count').notNull().default(0),
});

export const trials = sqliteTable(
  'trials',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    level: integer('level').notNull(),
    createdAt: text('created_at').notNull(),
    centroid: real('centroid'),
    bandRatio: real('band_ratio'),
    spread: real('spread'),
    sDurationMs: integer('s_duration_ms'),
    voicing: real('voicing'),
    acousticScore: real('acoustic_score'),
    asrText: text('asr_text'),
    asrMatch: integer('asr_match'),
    selfRating: text('self_rating'),
    score: real('score'),
    passed: integer('passed'),
    feedbackShown: integer('feedback_shown'),
    practice: text('practice'),
    kind: text('kind'),
    deviceLabel: text('device_label'),
    recordingKey: text('recording_key'),
  },
  (table) => [
    index('trials_session_idx').on(table.sessionId),
    index('trials_created_idx').on(table.createdAt),
    index('trials_level_idx').on(table.level),
  ],
);

export const recordings = sqliteTable('recordings', {
  key: text('key').primaryKey(),
  kind: text('kind').notNull(),
  mime: text('mime').notNull(),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull(),
  transcript: text('transcript'),
  wpm: real('wpm'),
});

export const progression = sqliteTable('progression', {
  level: integer('level').primaryKey(),
  status: text('status').notNull(),
  accuracyWindow: text('accuracy_window'),
  passedAt: text('passed_at'),
  nextRetestAt: text('next_retest_at'),
  retestStage: integer('retest_stage').default(0),
});

export const diagnostics = sqliteTable('diagnostics', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  acoustic: text('acoustic').notNull(),
  tongueVisible: integer('tongue_visible'),
  airAtCorners: integer('air_at_corners'),
  pattern: text('pattern').notNull(),
  signalCount: integer('signal_count').notNull(),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Trial = typeof trials.$inferSelect;
export type NewTrial = typeof trials.$inferInsert;
export type Recording = typeof recordings.$inferSelect;
export type NewRecording = typeof recordings.$inferInsert;
export type Progression = typeof progression.$inferSelect;
export type NewProgression = typeof progression.$inferInsert;
export type Diagnostic = typeof diagnostics.$inferSelect;
export type NewDiagnostic = typeof diagnostics.$inferInsert;
