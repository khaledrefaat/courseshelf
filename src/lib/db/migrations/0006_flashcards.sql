CREATE TABLE flashcard_sets (
    id INTEGER PRIMARY KEY,
    lesson_id INTEGER NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
    generation_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    source_name TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    validator_version TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    usage_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Transient transfer column: triggers publish all cards in the same statement.
    -- Never use BEGIN/COMMIT across tauri-plugin-sql's pooled execute calls.
    card_payload TEXT CHECK(card_payload IS NULL OR
        (json_valid(card_payload) AND json_type(card_payload)='array' AND json_array_length(card_payload)<=25))
);

CREATE TABLE flashcards (
    id INTEGER PRIMARY KEY,
    set_id INTEGER NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    question TEXT NOT NULL CHECK(length(question) BETWEEN 1 AND 300),
    answer TEXT NOT NULL CHECK(length(answer) BETWEEN 1 AND 1500),
    extra_context TEXT CHECK(extra_context IS NULL OR length(extra_context) BETWEEN 1 AND 500),
    evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
    edited INTEGER NOT NULL DEFAULT 0 CHECK(edited IN (0,1)),
    UNIQUE(set_id,sort_order)
);

CREATE TRIGGER flashcards_publish_insert AFTER INSERT ON flashcard_sets
WHEN NEW.card_payload IS NOT NULL
BEGIN
    INSERT INTO flashcards(set_id,sort_order,question,answer,extra_context,evidence_json)
    SELECT NEW.id,CAST(key AS INTEGER),json_extract(value,'$.question'),
        json_extract(value,'$.answer'),json_extract(value,'$.extraContext'),json_extract(value,'$.evidence')
    FROM json_each(NEW.card_payload);
    UPDATE flashcard_sets SET card_payload=NULL WHERE id=NEW.id;
END;

CREATE TRIGGER flashcards_publish_update AFTER UPDATE OF card_payload ON flashcard_sets
WHEN NEW.card_payload IS NOT NULL
BEGIN
    DELETE FROM flashcards WHERE set_id=NEW.id;
    INSERT INTO flashcards(set_id,sort_order,question,answer,extra_context,evidence_json)
    SELECT NEW.id,CAST(key AS INTEGER),json_extract(value,'$.question'),
        json_extract(value,'$.answer'),json_extract(value,'$.extraContext'),json_extract(value,'$.evidence')
    FROM json_each(NEW.card_payload);
    UPDATE flashcard_sets SET card_payload=NULL WHERE id=NEW.id;
END;
