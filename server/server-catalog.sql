PRAGMA user_version = 1;

CREATE TABLE catalog (
	schema_version INTEGER NOT NULL,
	version TEXT NOT NULL,
	generated_at INTEGER NOT NULL
);

CREATE TABLE songs (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	artist TEXT NOT NULL,
	preview_seconds REAL NOT NULL,
	audio_path TEXT NOT NULL,
	background_path TEXT
);

CREATE TABLE charts (
	id TEXT PRIMARY KEY,
	song_id TEXT NOT NULL,
	name TEXT NOT NULL,
	creator TEXT NOT NULL,
	mode INTEGER NOT NULL,
	keys INTEGER NOT NULL,
	chart_path TEXT NOT NULL UNIQUE,
	FOREIGN KEY (song_id) REFERENCES songs(id)
);

CREATE INDEX charts_song_id_idx ON charts(song_id);
