PRAGMA user_version = 4;

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

CREATE TABLE locations (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE
);

CREATE TABLE charts (
	id TEXT PRIMARY KEY,
	song_id TEXT NOT NULL,
	location_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	creator TEXT NOT NULL,
	mode INTEGER NOT NULL,
	keys INTEGER,
	duration_seconds REAL NOT NULL,
	note_count INTEGER NOT NULL,
	long_note_ratio REAL NOT NULL,
	bpm_min REAL NOT NULL,
	bpm_max REAL NOT NULL,
	bpm_avg REAL NOT NULL,
	difficulty REAL NOT NULL,
	format TEXT NOT NULL,
	chart_path TEXT NOT NULL UNIQUE,
	FOREIGN KEY (song_id) REFERENCES songs(id),
	FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE INDEX charts_song_id_idx ON charts(song_id);
CREATE INDEX charts_location_id_idx ON charts(location_id);
