CREATE TABLE courses (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    cover_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lessons (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL
        REFERENCES courses(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, relative_path)
);

CREATE TABLE progress (
    lesson_id INTEGER PRIMARY KEY
        REFERENCES lessons(id) ON DELETE CASCADE,
    completed INTEGER NOT NULL DEFAULT 0
        CHECK (completed IN (0, 1)),
    last_position_seconds REAL NOT NULL DEFAULT 0,
    last_watched_at TEXT
);

CREATE TABLE notes (
    lesson_id INTEGER PRIMARY KEY
        REFERENCES lessons(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
