// app/workspace/[notebookId]/page.tsx
// 노트북 워크스페이스 - PDF 업로드 + AI 학습 공간

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import WorkspaceClient from "./WorkspaceClient";

interface Props {
  params: Promise<{ notebookId: string }>;
}

export default async function WorkspacePage({ params }: Props) {
  const { notebookId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (!user || error) redirect("/login");

  const { data: notebook } = await supabase
    .from("notebooks")
    .select("*")
    .eq("id", notebookId)
    .eq("user_id", user.id)
    .single();

  if (!notebook) redirect("/dashboard");

  return <WorkspaceClient notebook={notebook} />;
}
