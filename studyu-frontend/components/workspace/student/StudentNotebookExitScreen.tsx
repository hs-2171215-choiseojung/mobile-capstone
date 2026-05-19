"use client";

import { BotMessageSquare } from "lucide-react";
import { TopNavBar } from "@/components/workspace/student/TopNavBar";
import type { StudentNotebookExitReason } from "@/components/workspace/student/studentNotebookExitState";

interface Props {
  title?: string;
  reason: StudentNotebookExitReason;
  onBackClick?: () => void;
}

const COPY: Record<StudentNotebookExitReason, { title: string; body: string }> = {
  removed: {
    title: "나가진 노트북",
    body: "강사가 이 노트북의 학생 목록에서 회원님을 삭제해서 더 이상 학습 자료를 볼 수 없어요.",
  },
  deleted: {
    title: "없는 노트북",
    body: "강사에 의해 이 노트북이 삭제되어 더 이상 학습 자료를 볼 수 없어요.",
  },
};

export default function StudentNotebookExitScreen({ title, reason, onBackClick }: Props) {
  const copy = COPY[reason];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <TopNavBar title={title || "노트북"} onBackClick={onBackClick} />
      <div className="flex-1 overflow-y-auto bg-[#fff7f7] px-6 py-10 pt-[64px]">
        <div className="mx-auto flex min-h-full max-w-[760px] items-center justify-center">
          <div className="w-full rounded-[28px] border border-[#fecaca] bg-white px-8 py-12 text-center shadow-[0_20px_60px_rgba(127,29,29,0.08)]">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#fee2e2] text-[#dc2626]">
              <BotMessageSquare className="h-7 w-7" />
            </div>
            <p className="mb-3 text-sm font-semibold tracking-[0.08em] text-[#dc2626]">NOTEBOOK STATUS</p>
            <h1 className="text-[24px] font-semibold text-[#991b1b]">{copy.title}</h1>
            <p className="mt-3 text-[15px] leading-7 text-[#b91c1c]">{copy.body}</p>
            <p className="mt-2 text-[15px] leading-7 text-[#b91c1c]">
              왼쪽 위 뒤로가기를 눌러 학생 대시보드로 돌아가 주세요.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
