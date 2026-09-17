CREATE TABLE `diagnostics` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`acoustic` text NOT NULL,
	`tongue_visible` integer,
	`air_at_corners` integer,
	`pattern` text NOT NULL,
	`signal_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`sound` text NOT NULL,
	`position` text,
	`text` text NOT NULL,
	`minimal_pair` text,
	`model_audio_key` text,
	`tags` text
);
--> statement-breakpoint
CREATE INDEX `exercises_level_idx` ON `exercises` (`level`);--> statement-breakpoint
CREATE TABLE `progression` (
	`level` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`accuracy_window` text,
	`passed_at` text,
	`next_retest_at` text,
	`retest_stage` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	`transcript` text,
	`wpm` real
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`level` integer NOT NULL,
	`trial_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`lisp_pattern` text DEFAULT 'unknown' NOT NULL,
	`noise_floor` real,
	`target_centroid` real,
	`target_ratio` real,
	`tolerance` real,
	`feedback_rate` real DEFAULT 1 NOT NULL,
	`sample_rate` real,
	`device_label` text,
	`calibrated_at` text,
	`diagnosed_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_singleton" CHECK("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `trials` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`level` integer NOT NULL,
	`created_at` text NOT NULL,
	`centroid` real,
	`band_ratio` real,
	`spread` real,
	`s_duration_ms` integer,
	`voicing` real,
	`acoustic_score` real,
	`asr_text` text,
	`asr_match` integer,
	`self_rating` text,
	`score` real,
	`passed` integer,
	`feedback_shown` integer,
	`practice` text,
	`kind` text,
	`device_label` text,
	`recording_key` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trials_session_idx` ON `trials` (`session_id`);--> statement-breakpoint
CREATE INDEX `trials_created_idx` ON `trials` (`created_at`);--> statement-breakpoint
CREATE INDEX `trials_level_idx` ON `trials` (`level`);