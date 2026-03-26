"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import StudentsPageClient from "./StudentsPageClient";

interface Props {
  searchParams: Promise<{ notebook?: string }>;
}

export default async function StudentsPage({ searchParams }: Props) {
  const { notebook: notebookId } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) redirect("/login");

  if (!notebookId) redirect("/dashboard/instructor");

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Get session token for API call
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  let notebookData: {
    notebook_id: string;
    title: string;
    students: {
      enrollment_id: string;
      joined_at: string;
      id: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
    }[];
  } | null = null;

  let errorMsg: string | null = null;

  try {
    const res = await fetch(
      `${apiBase}/api/notebooks/${notebookId}/students`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      errorMsg = "데이터를 불러오지 못했습니다.";
    } else {
      notebookData = await res.json();
    }
  } catch {
    errorMsg = "서버 연결에 실패했습니다.";
  }

  return (
    <StudentsPageClient
      notebookData={notebookData}
      errorMsg={errorMsg}
    />
  );
}
