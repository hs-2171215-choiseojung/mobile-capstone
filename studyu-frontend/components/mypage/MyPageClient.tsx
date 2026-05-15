"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import StudyULogo from "@/components/StudyULogo";

type Role = "instructor" | "student";
type Status = { type: "ok" | "err"; text: string } | null;

interface Props {
  email: string;
  createdAt: string;
  displayName: string;
  avatarUrl?: string;
  role: Role;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DELETE_CONFIRM_PHRASE = "삭제";

const VOICE_OPTIONS = [
  { value: "sarah", label: "Sarah · 차분한 여성" },
  { value: "rachel", label: "Rachel · 명확한 여성" },
  { value: "josh", label: "Josh · 친근한 남성" },
  { value: "adam", label: "Adam · 전문적인 남성" },
];

const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o · 높은 품질" },
  { value: "gpt-4o-mini", label: "GPT-4o mini · 빠르고 저렴" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 · 균형잡힌 성능" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 · 빠름" },
];

function normalizeLearningLevel(value: string | null | undefined): "beginner" | "intermediate" | "advanced" {
  switch (value) {
    case "beginner":
    case "easy":
      return "beginner";
    case "advanced":
    case "brief":
      return "advanced";
    case "intermediate":
    case "normal":
    default:
      return "intermediate";
  }
}

const LEVEL_OPTIONS: { value: "beginner" | "intermediate" | "advanced"; label: string }[] = [
  { value: "beginner", label: "쉽게" },
  { value: "intermediate", label: "보통" },
  { value: "advanced", label: "간략하게" },
];

const PLAYBACK_OPTIONS = ["0.75", "1", "1.25", "1.5", "1.75", "2"];

const ROLE_LABEL: Record<Role, string> = {
  instructor: "강사",
  student: "학생",
};

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return "-";
  }
}

function readLS(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) || fallback;
}

export default function MyPageClient({ email, createdAt, displayName, avatarUrl, role }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const initial = displayName[0]?.toUpperCase() || "U";

  // ── 프로필 ──────────────────────────────────────
  const [name, setName] = useState(displayName);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Status>(null);

  // 서버에서 새 displayName이 내려오면(저장 후 router.refresh, 또는 RSC 캐시 갱신 후 재진입)
  // input 값이 같이 따라오도록 동기화.
  useEffect(() => {
    setName(displayName);
  }, [displayName]);

  // ── 비밀번호 ────────────────────────────────────
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<Status>(null);

  // ── 학습 기본값 (localStorage) ──────────────────
  const [level, setLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [voice, setVoice] = useState("sarah");
  const [model, setModel] = useState("gpt-4o");
  const [playbackRate, setPlaybackRate] = useState("1");
  const [settingsMsg, setSettingsMsg] = useState<Status>(null);

  useEffect(() => {
    setLevel(normalizeLearningLevel(readLS("studyu_default_level", "intermediate")));
    setVoice(readLS("studyu_default_voice", "sarah"));
    setModel(readLS("studyu_default_model", "gpt-4o"));
    setPlaybackRate(readLS("studyu_playback_rate", "1"));
  }, []);

  async function saveProfile() {
    setProfileMsg(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileMsg({ type: "err", text: "이름을 입력해주세요." });
      return;
    }

    setProfileSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      // public.users와 auth user_metadata를 함께 갱신해야 두 경로(InstructorWorkspace 등)가 일치한다.
      const [{ error: tableError }, { error: metaError }] = await Promise.all([
        supabase.from("users").update({ display_name: trimmed }).eq("id", user.id),
        supabase.auth.updateUser({ data: { display_name: trimmed, name: trimmed, full_name: trimmed } }),
      ]);

      if (tableError) {
        setProfileMsg({ type: "err", text: tableError.message });
        return;
      }
      if (metaError) {
        setProfileMsg({ type: "err", text: metaError.message });
        return;
      }

      setProfileMsg({ type: "ok", text: "프로필이 저장되었습니다." });
      router.refresh();
    } catch (e: any) {
      setProfileMsg({ type: "err", text: e?.message || "저장에 실패했습니다." });
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (!currentPw || !newPw || !confirmPw) {
      setPwMsg({ type: "err", text: "모든 비밀번호 필드를 입력해주세요." });
      return;
    }
    if (newPw.length < 8) {
      setPwMsg({ type: "err", text: "새 비밀번호는 8자 이상이어야 합니다." });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ type: "err", text: "새 비밀번호와 확인이 일치하지 않습니다." });
      return;
    }
    if (newPw === currentPw) {
      setPwMsg({ type: "err", text: "새 비밀번호가 현재 비밀번호와 같습니다." });
      return;
    }

    setPwSaving(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPw,
      });
      if (verifyError) {
        setPwMsg({ type: "err", text: "현재 비밀번호가 올바르지 않습니다." });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) {
        setPwMsg({ type: "err", text: error.message });
        return;
      }

      setPwMsg({ type: "ok", text: "비밀번호가 변경되었습니다." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } finally {
      setPwSaving(false);
    }
  }

  function saveSettings() {
    localStorage.setItem("studyu_default_level", level);
    localStorage.setItem("studyu_default_voice", voice);
    localStorage.setItem("studyu_default_model", model);
    localStorage.setItem("studyu_playback_rate", playbackRate);
    setSettingsMsg({ type: "ok", text: "설정이 저장되었습니다." });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // ── 계정 삭제 ───────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<Status>(null);
  const [isGoogleUser, setIsGoogleUser] = useState(false);

  async function openDeleteModal() {
    const { data: { user } } = await supabase.auth.getUser();
    const provider = user?.app_metadata?.provider;
    setIsGoogleUser(provider === "google");
    setDeleteOpen(true);
    setDeletePw("");
    setDeletePhrase("");
    setDeleteMsg(null);
  }

  async function confirmDeleteAccount() {
    if (deletePhrase.trim() !== DELETE_CONFIRM_PHRASE) {
      setDeleteMsg({ type: "err", text: `확인 문구로 "${DELETE_CONFIRM_PHRASE}"를 정확히 입력해주세요.` });
      return;
    }
    if (!isGoogleUser && !deletePw) {
      setDeleteMsg({ type: "err", text: "현재 비밀번호를 입력해주세요." });
      return;
    }

    setDeleting(true);
    setDeleteMsg(null);
    try {
      if (!isGoogleUser) {
        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email,
          password: deletePw,
        });
        if (verifyError) {
          setDeleteMsg({ type: "err", text: "현재 비밀번호가 올바르지 않습니다." });
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setDeleteMsg({ type: "err", text: "세션이 만료되었습니다. 다시 로그인해주세요." });
        return;
      }

      const res = await fetch(`${API}/api/users/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: "" }));
        setDeleteMsg({ type: "err", text: detail.detail || "계정 삭제에 실패했습니다." });
        return;
      }

      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StudyULogo size={32} />
            <span className="font-bold text-lg">
              STUDY<span className="text-blue-600">:U</span>
            </span>
          </div>
          <Link
            href={`/dashboard/${role}`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            대시보드로
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">마이페이지</h1>
          <p className="text-sm text-gray-500 mt-1">계정 정보와 학습 환경을 관리합니다.</p>
        </div>

        {/* 프로필 */}
        <Section title="프로필" description="계정 표시 이름과 기본 정보를 확인합니다.">
          <div className="flex items-center gap-4 mb-5">
            {avatarUrl ? (
              <Image src={avatarUrl} alt="프로필" width={64} height={64} className="rounded-full w-16 h-16" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-pink-100 flex items-center justify-center text-xl font-semibold text-pink-600">
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-gray-900 truncate">{displayName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                  {ROLE_LABEL[role]}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">가입일 · {formatDate(createdAt)}</div>
            </div>
          </div>

          <Field label="이름">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              placeholder="이름을 입력하세요"
            />
          </Field>

          <Field label="이메일">
            <input
              type="email"
              value={email}
              readOnly
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
            />
          </Field>

          <SaveRow
            saving={profileSaving}
            msg={profileMsg}
            onSave={saveProfile}
            disabled={name.trim() === displayName.trim() || !name.trim()}
          />
        </Section>

        {/* 비밀번호 */}
        <Section title="비밀번호 변경" description="새 비밀번호는 8자 이상이어야 합니다.">
          <Field label="현재 비밀번호">
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </Field>
          <Field label="새 비밀번호">
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </Field>
          <Field label="새 비밀번호 확인">
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </Field>

          <SaveRow
            saving={pwSaving}
            msg={pwMsg}
            onSave={changePassword}
            label="비밀번호 변경"
            disabled={!currentPw || !newPw || !confirmPw}
          />
        </Section>

        {/* 학습 기본값 — 학생 전용 */}
        {role === "student" && (
          <Section title="학습 기본값" description="채팅과 음성 재생의 기본값을 설정합니다.">
            <Field label="학습 레벨">
              <Select value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
            </Field>
            <Field label="기본 음성">
              <Select value={voice} onChange={setVoice} options={VOICE_OPTIONS} />
            </Field>
            <Field label="기본 모델">
              <Select value={model} onChange={setModel} options={MODEL_OPTIONS} />
            </Field>
            <Field label="음성 재생 속도">
              <Select
                value={playbackRate}
                onChange={setPlaybackRate}
                options={PLAYBACK_OPTIONS.map((v) => ({ value: v, label: `${v}x` }))}
              />
            </Field>

            <SaveRow saving={false} msg={settingsMsg} onSave={saveSettings} />
          </Section>
        )}

        {/* 계정 */}
        <Section title="계정" description="로그아웃하거나 계정을 영구 삭제합니다.">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              로그아웃
            </button>
            <button
              onClick={openDeleteModal}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              계정 삭제
            </button>
          </div>
        </Section>
      </main>

      {deleteOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900">계정을 삭제하시겠습니까?</h3>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              계정을 삭제하면 보유한 노트북, 문서, 학습 기록이 <strong className="text-red-600">영구 삭제</strong>되며 복구할 수 없습니다.
            </p>
            {role === "instructor" && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 leading-relaxed">
                <strong>강사 안내</strong> · 본인이 만든 노트북에 <strong>수강생이 한 명이라도 등록되어 있으면</strong> 계정 삭제가 차단됩니다.
                먼저 해당 노트북을 정리해주세요.
              </div>
            )}

            <div className="mt-5 space-y-3">
              {!isGoogleUser && (
                <Field label="현재 비밀번호">
                  <input
                    type="password"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                    autoComplete="current-password"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  />
                </Field>
              )}
              <Field label={`확인 문구 — "${DELETE_CONFIRM_PHRASE}"를 입력해주세요`}>
                <input
                  type="text"
                  value={deletePhrase}
                  onChange={(e) => setDeletePhrase(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                  placeholder={DELETE_CONFIRM_PHRASE}
                />
              </Field>
            </div>

            {deleteMsg && (
              <p className={`mt-3 text-xs ${deleteMsg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
                {deleteMsg.text}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={confirmDeleteAccount}
                disabled={deleting || deletePhrase.trim() !== DELETE_CONFIRM_PHRASE || (!isGoogleUser && !deletePw)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {deleting ? "삭제 중..." : "영구 삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Presentational helpers
// ─────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-gray-600 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function SaveRow({
  saving,
  msg,
  onSave,
  label = "저장",
  disabled,
}: {
  saving: boolean;
  msg: Status;
  onSave: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        onClick={onSave}
        disabled={saving || disabled}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {saving ? "저장 중..." : label}
      </button>
      {msg && (
        <span className={`text-xs ${msg.type === "ok" ? "text-green-600" : "text-red-600"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
