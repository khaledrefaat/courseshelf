-- Expand only the context check. SQLite requires rebuilding the child table;
-- the SQL plugin runs this migration in a transaction with foreign keys enabled.
-- Keep every row ID and field, and leave flashcard_sets/migration history intact.
DROP TRIGGER flashcards_publish_insert;
DROP TRIGGER flashcards_publish_update;

CREATE TABLE flashcards_expanded (
    id INTEGER PRIMARY KEY,
    set_id INTEGER NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    question TEXT NOT NULL CHECK(length(question) BETWEEN 1 AND 300),
    answer TEXT NOT NULL CHECK(length(answer) BETWEEN 1 AND 1500),
    extra_context TEXT CHECK(extra_context IS NULL OR length(extra_context) BETWEEN 1 AND 1200),
    evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
    edited INTEGER NOT NULL DEFAULT 0 CHECK(edited IN (0,1)),
    UNIQUE(set_id,sort_order)
);

INSERT INTO flashcards_expanded(id,set_id,sort_order,question,answer,extra_context,evidence_json,edited)
SELECT id,set_id,sort_order,question,answer,extra_context,evidence_json,edited FROM flashcards;

DROP TABLE flashcards;
ALTER TABLE flashcards_expanded RENAME TO flashcards;

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
