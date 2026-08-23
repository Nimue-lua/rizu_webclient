PRAGMA user_version = 6;

CREATE TABLE catalog (
	schema_version INTEGER NOT NULL,
	version TEXT NOT NULL,
	generated_at INTEGER NOT NULL
);

CREATE TABLE songs (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	title_unicode TEXT NOT NULL,
	artist TEXT NOT NULL,
	artist_unicode TEXT NOT NULL,
	source TEXT NOT NULL,
	tags TEXT NOT NULL
);

CREATE TABLE locations (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	path TEXT NOT NULL UNIQUE
);

CREATE TABLE charts (
	id TEXT PRIMARY KEY,
	song_id TEXT NOT NULL REFERENCES songs(id),
	location_id INTEGER NOT NULL REFERENCES locations(id),
	name TEXT NOT NULL,
	creator TEXT NOT NULL,
	mode INTEGER NOT NULL,
	keys INTEGER,
	beatmap_id INTEGER,
	duration_seconds REAL NOT NULL,
	note_count INTEGER NOT NULL,
	long_note_ratio REAL NOT NULL,
	bpm_min REAL NOT NULL,
	bpm_max REAL NOT NULL,
	bpm_avg REAL NOT NULL,
	difficulty REAL NOT NULL,
	format TEXT NOT NULL,
	chart_path TEXT NOT NULL UNIQUE,
	audio_path TEXT NOT NULL,
	preview_seconds REAL NOT NULL,
	background_preview_path TEXT,
	FOREIGN KEY (song_id) REFERENCES songs(id)
);

CREATE INDEX charts_song_id_idx ON charts(song_id);
CREATE INDEX charts_location_id_idx ON charts(location_id);
CREATE INDEX songs_title_idx ON songs(title COLLATE NOCASE);
CREATE INDEX songs_artist_idx ON songs(artist COLLATE NOCASE);
