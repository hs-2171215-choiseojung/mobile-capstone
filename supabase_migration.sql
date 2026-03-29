-- ============================================================
-- STUDY:U Supabase 마이그레이션
-- Supabase Dashboard > SQL Editor에서 순서대로 실행하세요.
-- ============================================================

-- ── 1. documents 테이블에 새 컬럼 추가 ───────────────────────
-- (테이블이 이미 존재하면 컬럼만 추가, 없으면 아래 CREATE부터 실행)

ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path  TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count   INT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count    INT;

-- documents 테이블이 아직 없다면 아래 블록을 실행하세요:
/*
CREATE TABLE IF NOT EXISTS documents (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    notebook_id  UUID        NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL,
    filename     TEXT        NOT NULL,
    file_type    TEXT        NOT NULL DEFAULT 'pdf',
    file_size    BIGINT,
    storage_path TEXT        NOT NULL DEFAULT '',
    status       TEXT        NOT NULL DEFAULT 'ready',
    chunk_count  INT,
    page_count   INT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
*/

-- ── 2. document_chunks 테이블 생성 ───────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id      UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INT         NOT NULL,
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 검색 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id
    ON document_chunks(doc_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_documents_notebook_id
    ON documents(notebook_id);

-- ── 3. Supabase Storage 버킷 생성 ────────────────────────────
-- Storage > New bucket > Name: "documents", Public: OFF
-- 아래 SQL로도 생성 가능합니다:
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Storage RLS 정책 ───────────────────────────────────────
-- 사용자가 자신의 폴더(/{user_id}/)에만 접근 가능하도록 설정

-- 업로드 정책
CREATE POLICY "users can upload own documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'documents'
    AND (string_to_array(name, '/'))[1] = auth.uid()::text
);

-- 다운로드 정책
CREATE POLICY "users can read own documents"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'documents'
    AND (string_to_array(name, '/'))[1] = auth.uid()::text
);

-- 삭제 정책
CREATE POLICY "users can delete own documents"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'documents'
    AND (string_to_array(name, '/'))[1] = auth.uid()::text
);

-- ── 5. documents 테이블 RLS ───────────────────────────────────
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own documents"
ON documents FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "users can insert own documents"
ON documents FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own documents"
ON documents FOR UPDATE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "users can delete own documents"
ON documents FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ── 6. document_chunks 테이블 RLS ────────────────────────────
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- chunks는 documents를 통해 소유권 확인
CREATE POLICY "users can read own chunks"
ON document_chunks FOR SELECT TO authenticated
USING (
    doc_id IN (
        SELECT id FROM documents WHERE user_id = auth.uid()
    )
);

-- ── 7. instructor_weeks 컬럼 (강사 주차별 학습 계획 저장) ──────
-- study_plans 테이블에 이미 추가되어 있습니다. 실행 불필요.
-- ALTER TABLE study_plans ADD COLUMN IF NOT EXISTS instructor_weeks JSONB NOT NULL DEFAULT '[]';
-- (현재 DB에 이미 반영됨)
