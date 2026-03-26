// app/workspace/[notebookId]/page.tsx
// 노트북 워크스페이스 - PDF 업로드 + AI 학습 공간

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import WorkspaceClient from "./WorkspaceClient";

interface Props {
  params: Promise<{ notebookId: string }>;
  searchParams: Promise<{ from?: string }>;
}

export default async function WorkspacePage({ params, searchParams }: Props) {
  const { notebookId } = await params;
  const { from } = await searchParams;
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

  const { data: initialDocs } = await supabase
    .from("documents")
    .select("id, filename, chunk_count, file_type, storage_path")
    .eq("notebook_id", notebookId)
    .eq("status", "ready")
    .order("created_at", { ascending: true });

  return <WorkspaceClient notebook={notebook} initialDocs={initialDocs ?? []} backUrl={from || "/dashboard"} />;
}
