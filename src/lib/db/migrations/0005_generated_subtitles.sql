CREATE TABLE generated_subtitles (
    lesson_id INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
    filename TEXT NOT NULL UNIQUE,
    source_fingerprint TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_sha256 TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en' CHECK (language = 'en'),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
