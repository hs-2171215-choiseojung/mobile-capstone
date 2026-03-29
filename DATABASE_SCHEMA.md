# STUDY:U 데이터베이스 스키마

> Supabase PostgreSQL 기준. 최종 업데이트: 2026-03-29

---

## 테이블 목록

| 테이블 | 설명 |
|--------|------|
| `users` | 사용자 계정 |
| `notebooks` | 노트북(과목 단위 컨테이너) |
| `notebook_enrollments` | 학생 노트북 참여 |
| `documents` | 업로드된 문서 |
| `document_chunks` | 문서 청크(레거시, RAG용) |
| `chunks` | 문서 청크(pgvector 임베딩 포함) |
| `conversations` | 대화 세션 |
| `messages` | 대화 메시지 |
| `quiz_sessions` | 퀴즈 세션 |
| `quiz_questions` | 퀴즈 문항 |
| `studio_items` | 스튜디오 생성 콘텐츠 |
| `study_plans` | 학습 계획 (AI 생성 + 강사 주차 구성) |
| `summaries` | 문서 요약 |

---

## 상세 스키마

### `users`
```sql
id           uuid  PK  -- auth.users(id) 참조
email        text  UNIQUE NOT NULL
display_name text
avatar_url   text
created_at   timestamptz NOT NULL DEFAULT now()
updated_at   timestamptz NOT NULL DEFAULT now()
```

---

### `notebooks`
```sql
id            uuid  PK
user_id       uuid  NOT NULL → users(id)
title         text  NOT NULL
description   text
default_model llm_provider NOT NULL DEFAULT 'openai'
difficulty    difficulty_level NOT NULL DEFAULT 'intermediate'
notebook_type text  NOT NULL DEFAULT 'student'  -- 'student' | 'instructor'
invite_code   text  UNIQUE                       -- 강사 노트북 초대 코드
is_starred    boolean DEFAULT false
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
```

---

### `notebook_enrollments`
```sql
id          uuid  PK
notebook_id uuid → notebooks(id)
student_id  uuid → users(id)
created_at  timestamptz DEFAULT now()
```

---

### `documents`
```sql
id           uuid  PK
notebook_id  uuid  NOT NULL → notebooks(id)
user_id      uuid  NOT NULL → users(id)
filename     text  NOT NULL
file_url     text
file_type    document_file_type NOT NULL   -- ENUM
file_size    bigint
status       document_status NOT NULL DEFAULT 'uploading'  -- ENUM
error_message text
page_count   integer
chunk_count  integer DEFAULT 0
storage_path text  NOT NULL DEFAULT ''
created_at   timestamptz NOT NULL DEFAULT now()
updated_at   timestamptz NOT NULL DEFAULT now()
```

---

### `document_chunks` *(레거시)*
```sql
id          uuid  PK
doc_id      uuid  NOT NULL → documents(id)
chunk_index integer NOT NULL
content     text  NOT NULL
embedding   jsonb
created_at  timestamptz DEFAULT now()
```

---

### `chunks` *(pgvector 사용)*
```sql
id          uuid  PK
document_id uuid  NOT NULL → documents(id)
content     text  NOT NULL
embedding   vector (pgvector USER-DEFINED)
chunk_index integer NOT NULL
page_number integer
metadata    jsonb DEFAULT '{}'
created_at  timestamptz NOT NULL DEFAULT now()
```

---

### `conversations`
```sql
id                uuid  PK
notebook_id       uuid  NOT NULL → notebooks(id)
user_id           uuid  NOT NULL → users(id)
title             text
conversation_type conversation_type NOT NULL DEFAULT 'chat'  -- ENUM
difficulty        difficulty_level NOT NULL DEFAULT 'intermediate'
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()
```

---

### `messages`
```sql
id              uuid  PK
conversation_id uuid  NOT NULL → conversations(id)
role            message_role NOT NULL   -- ENUM: 'user' | 'assistant' 등
content         text  NOT NULL
citations       jsonb DEFAULT '[]'
model_used      text
token_count     integer
created_at      timestamptz NOT NULL DEFAULT now()
```

---

### `quiz_sessions`
```sql
id                  uuid  PK
conversation_id     uuid → conversations(id)
notebook_id         uuid  NOT NULL → notebooks(id)
user_id             uuid  NOT NULL → users(id)
difficulty          difficulty_level NOT NULL DEFAULT 'intermediate'
total_questions     integer NOT NULL DEFAULT 5
correct_count       integer NOT NULL DEFAULT 0
status              quiz_status NOT NULL DEFAULT 'in_progress'  -- ENUM
source_document_ids jsonb DEFAULT '[]'
model_used          text
created_at          timestamptz NOT NULL DEFAULT now()
completed_at        timestamptz
```

---

### `quiz_questions`
```sql
id              uuid  PK
quiz_session_id uuid  NOT NULL → quiz_sessions(id)
question_text   text  NOT NULL
question_type   question_type NOT NULL DEFAULT 'multiple_choice'  -- ENUM
options         jsonb
correct_answer  text  NOT NULL
user_answer     text
is_correct      boolean
explanation     text
order_index     integer NOT NULL
created_at      timestamptz NOT NULL DEFAULT now()
```

---

### `studio_items`
스튜디오에서 AI가 생성한 콘텐츠(오디오, 퀴즈, 마인드맵, 슬라이드, 플래시카드, 리포트)를 저장합니다.

```sql
id         uuid  PK
user_id    text  NOT NULL       -- auth user id (text 타입 주의)
type       text  NOT NULL       -- 'audio' | 'quiz' | 'mindmap' | 'slides' | 'flashcard' | 'report'
title      text  NOT NULL
subtitle   text  DEFAULT ''
content    jsonb DEFAULT '{}'   -- 타입별 상세 데이터
audio_path text                 -- 오디오 파일 경로 (type='audio')
notebook_id uuid → notebooks(id)
created_at timestamptz DEFAULT now()
```

**`content` JSONB 구조 (type별):**

| type | content 필드 |
|------|-------------|
| `audio` | `{ base64, script, format }` |
| `quiz` | `{ questions: [{question, options, answer, explanation}] }` |
| `mindmap` | `{ nodes: [{id, label, children}] }` |
| `slides` | `{ slides: [{title, content, notes}], cover_image_b64 }` |
| `flashcard` | `{ cards: [{front, back}] }` |
| `report` | `{ sections: [{title, content}], format }` |

---

### `study_plans`
AI 생성 학습계획과 강사 주차별 구성을 함께 저장합니다.

```sql
id               uuid  PK
notebook_id      uuid  NOT NULL → notebooks(id)
user_id          uuid  NOT NULL → users(id)
title            text  NOT NULL
  -- '__instructor_weekly_plan__' : 강사 주차 구성 전용 행 식별자
goal             text
start_date       date
end_date         date
plan_content     jsonb DEFAULT '{}'   -- AI 생성 학습계획 내용
priority_order   jsonb DEFAULT '[]'   -- 우선순위 순서
model_used       text
instructor_weeks jsonb NOT NULL DEFAULT '[]'   -- ★ 강사 주차별 구성
created_at       timestamptz NOT NULL DEFAULT now()
updated_at       timestamptz NOT NULL DEFAULT now()
```

**`instructor_weeks` JSONB 구조:**
```json
[
  {
    "id": 1,
    "title": "Week 1: iOS 개발환경",
    "status": "UPCOMING",
    "sources": [
      { "id": 1, "name": "ch01.pdf", "icon": "📄", "iconBg": "bg-red-50", "docId": "uuid" }
    ],
    "tasks": [
      { "id": 1, "icon": "🎧", "iconBg": "bg-blue-50", "title": "강의 오디오", "subtitle": "오디오 · 소스 1개", "itemId": "studio_item_uuid" }
    ]
  }
]
```

---

### `summaries`
```sql
id           uuid  PK
document_id  uuid  NOT NULL → documents(id)
notebook_id  uuid  NOT NULL → notebooks(id)
user_id      uuid  NOT NULL → users(id)
content      text  NOT NULL
summary_type summary_type NOT NULL DEFAULT 'brief'  -- ENUM
model_used   text
created_at   timestamptz NOT NULL DEFAULT now()
```

---

## ENUM 타입

| ENUM 이름 | 값 |
|-----------|-----|
| `llm_provider` | `'openai'`, `'claude'` 등 |
| `difficulty_level` | `'beginner'`, `'intermediate'`, `'advanced'` |
| `document_file_type` | `'pdf'`, `'url'`, `'youtube'`, `'text'`, `'image'` 등 |
| `document_status` | `'uploading'`, `'ready'`, `'error'` 등 |
| `conversation_type` | `'chat'` 등 |
| `message_role` | `'user'`, `'assistant'` 등 |
| `quiz_status` | `'in_progress'`, `'completed'` 등 |
| `question_type` | `'multiple_choice'`, `'true_false'`, `'short_answer'` 등 |
| `summary_type` | `'brief'`, `'detailed'` 등 |

---

## 관계도 (ERD 요약)

```
auth.users
    └── users
            ├── notebooks ──┬── documents ──── document_chunks
            │               │               └── chunks (pgvector)
            │               │               └── summaries
            │               ├── notebook_enrollments (← 학생)
            │               ├── conversations ──── messages
            │               │                 └── quiz_sessions ──── quiz_questions
            │               ├── studio_items
            │               └── study_plans (instructor_weeks 포함)
            └── (직접 참조 없음)
```
