import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MyPageClient from "@/components/mypage/MyPageClient";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("display_name, avatar_url, role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role || user.user_metadata?.role || "student") as "instructor" | "student";

  // 표시 이름 우선순위: public.users → user_metadata.* → 이메일 앞부분
  // user_metadata에 가입 시 자동 채워진 값(full_name=email prefix)이 있을 수 있어
  // public.users.display_name이 진짜 비어 있을 때만 그쪽을 쓴다.
  const displayName =
    profile?.display_name?.trim() ||
    (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "") ||
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "") ||
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
    user.email?.split("@")[0] ||
    "사용자";

  return (
    <MyPageClient
      email={user.email || ""}
      createdAt={user.created_at || ""}
      displayName={displayName}
      avatarUrl={profile?.avatar_url || undefined}
      role={role}
    />
  );
}
