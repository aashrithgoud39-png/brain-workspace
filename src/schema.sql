-- pgvector: lets PostgreSQL store embeddings (meaning fingerprints) and find the closest ones
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  login_id      TEXT NOT NULL,                     -- what people type on the sign-in page, e.g. AK-1042
  name          TEXT NOT NULL,
  team          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
  access        TEXT NOT NULL DEFAULT 'view' CHECK (access IN ('view', 'edit')),
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT false,    -- presence: shown as the green/grey dot
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IDs are matched case-insensitively at login, so uniqueness must be case-insensitive too
CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_lower_idx ON users (lower(login_id));

-- Knowledge sources. visibility decides who can find a document in search:
--   org      -> everyone
--   team     -> employees on documents.team, plus all managers
--   managers -> managers only
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  source      TEXT NOT NULL,
  content     TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'org' CHECK (visibility IN ('org', 'team', 'managers')),
  team        TEXT,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  search      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED
);
CREATE INDEX IF NOT EXISTS documents_search_idx ON documents USING GIN (search);

-- RAG: every document is split into small chunks; each chunk gets a 384-number embedding.
-- A chunk has no visibility of its own: permissions are always read from its parent document.
-- Deleting a document deletes its chunks automatically.
CREATE TABLE IF NOT EXISTS document_chunks (
  id          SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(384) NOT NULL,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  sender_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (sender_id, recipient_id, created_at);

CREATE TABLE IF NOT EXISTS meetings (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  date       DATE NOT NULL,
  time       TIME NOT NULL,
  link       TEXT NOT NULL,
  host_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No rows for a meeting = open to all employees
CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id INT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

-- What employees searched for, so managers can review it
CREATE TABLE IF NOT EXISTS search_history (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query        TEXT NOT NULL,
  result_count INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_history_created_idx ON search_history (created_at DESC);