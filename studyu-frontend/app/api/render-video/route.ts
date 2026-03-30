import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";

export const maxDuration = 300; // 5분 타임아웃

export async function POST(req: NextRequest) {
  try {
    const { slides } = await req.json();

    if (!slides || slides.length === 0) {
      return NextResponse.json({ error: "slides 데이터가 없습니다." }, { status: 400 });
    }

    // 동적 import (서버에서만 실행)
    const { bundle } = await import("@remotion/bundler");
    const { renderMedia, selectComposition } = await import("@remotion/renderer");

    const entryPoint = path.join(process.cwd(), "remotion", "index.ts");
    const outputDir = path.join(os.tmpdir(), "remotion-output");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `video-${Date.now()}.mp4`);

    console.log("[render-video] entryPoint:", entryPoint);
    console.log("[render-video] entryPoint exists:", fs.existsSync(entryPoint));

    // 1. 번들링
    console.log("[render-video] 번들링 시작...");
    const bundleLocation = await bundle({
      entryPoint,
      webpackOverride: (config) => config,
    });
    console.log("[render-video] 번들 완료:", bundleLocation);

    // 2. 컴포지션 선택
    console.log("[render-video] 컴포지션 선택 중...");
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "SlideVideo",
      inputProps: { slides },
    });
    console.log("[render-video] 컴포지션:", composition.id, composition.durationInFrames, "frames");

    // 3. 렌더링
    console.log("[render-video] 렌더링 시작...");
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps: { slides },
      onProgress: ({ progress }) => {
        console.log(`[render-video] 진행: ${Math.round(progress * 100)}%`);
      },
    });
    console.log("[render-video] 렌더링 완료:", outputPath);

    // 4. 파일 읽어서 반환
    const videoBuffer = fs.readFileSync(outputPath);
    const videoBase64 = videoBuffer.toString("base64");

    // 임시 파일 정리
    fs.unlinkSync(outputPath);

    return NextResponse.json({
      videoBase64,
      mimeType: "video/mp4",
    });
  } catch (e: unknown) {
    console.error("[render-video] 오류:", e);
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
