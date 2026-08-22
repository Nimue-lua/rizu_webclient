PRAGMA user_version = 2;

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
	tags TEXT NOT NULL,
	preview_seconds REAL NOT NULL,
	background_preview_path TEXT
);

CREATE TABLE charts (
	id TEXT PRIMARY KEY,
	song_id TEXT NOT NULL REFERENCES songs(id),
	name TEXT NOT NULL,
	creator TEXT NOT NULL,
	mode INTEGER NOT NULL,
	keys INTEGER NOT NULL,
	beatmap_id INTEGER,
	FOREIGN KEY (song_id) REFERENCES songs(id)
);

CREATE INDEX charts_song_id_idx ON charts(song_id);
CREATE INDEX songs_title_idx ON songs(title COLLATE NOCASE);
CREATE INDEX songs_artist_idx ON songs(artist COLLATE NOCASE);
