"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import StudentsPageClient from "./StudentsPageClient";

interface Notebook {
  id?: string;
  notebook_id?: string;
  title: string;
  student_count?: number;
}

interface Props {
  searchParams: Promise<{ notebook?: string }>;
}

export default async function StudentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const notebookId = params?.notebook as string;

  console.log("StudentsPage - notebookId:", notebookId);

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!user || error) redirect("/login");

  if (!notebookId) {
    console.log("No notebookId, redirecting to instructor dashboard");
    redirect("/dashboard/instructor");
  }

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

  let notebookList: Notebook[] = [];
  let errorMsg: string | null = null;

  // 강사의 노트북 목록만 가져오기 (먼저 실행)
  try {
    const res = await fetch(`${apiBase}/api/notebooks?notebook_type=instructor`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      console.log("Raw API response:", data);
      console.log("First notebook structure:", data[0] || (data.notebooks && data.notebooks[0]));
      notebookList = Array.isArray(data) ? data : data.notebooks || [];
      console.log("Notebooks loaded:", notebookList.map(n => ({ id: n.notebook_id, title: n.title })));
    } else {
      console.warn(`Notebook list fetch failed: ${res.status}`);
    }
  } catch (err) {
    console.warn("Notebook list fetch error:", err);
  }

  if (notebookId && token) {
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
        const errorText = await res.text();
        console.error(`API Error: ${res.status}`, errorText);
        errorMsg = "데이터를 불러오지 못했습니다.";
      } else {
        notebookData = await res.json();
      }
    } catch (err) {
      console.error("Fetch error:", err);
      errorMsg = "서버 연결에 실패했습니다.";
    }
  } else {
    console.log("Missing notebookId or token:", { notebookId, hasToken: !!token });
  }

  return (
    <StudentsPageClient
      notebookData={notebookData}
      errorMsg={errorMsg}
      notebookList={notebookList}
      currentNotebookId={notebookId}
    />
  );
}
