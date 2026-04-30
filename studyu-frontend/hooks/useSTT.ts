"use client";

import { useState, useRef, useCallback } from "react";

interface UseSTTOptions {
  lang?: string;
  onResult?: (text: string) => void;
  onError?: (message: string) => void;
}

interface UseSTTReturn {
  isRecording: boolean;
  interimText: string;
  sttError: string | null;
  start: (currentValue?: string) => void;
  stop: () => void;
  clearError: () => void;
}

export function useSTT({
  lang = "ko-KR",
  onResult,
  onError,
}: UseSTTOptions = {}): UseSTTReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const beforeValueRef = useRef<string>("");

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(
    (currentValue = "") => {
      setSttError(null);

      if (isRecording) {
        stop();
        return;
      }

      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        const msg =
          "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.";
        setSttError(msg);
        onError?.(msg);
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      beforeValueRef.current = currentValue;

      recognition.onstart = () => {
        setIsRecording(true);
        setInterimText("");
      };

      recognition.onend = () => {
        setIsRecording(false);
        setInterimText("");
      };

      recognition.onresult = (e: any) => {
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        if (interim) setInterimText(interim);
        if (final) {
          const trimmed = final.trim();
          setInterimText("");
          if (trimmed) {
            const prev = beforeValueRef.current;
            const result = prev ? `${prev} ${trimmed}` : trimmed;
            onResult?.(result);
          } else {
            const msg = "인식된 내용이 없어요. 다시 시도해 보세요.";
            setSttError(msg);
            onError?.(msg);
          }
        }
      };

      recognition.onerror = (e: any) => {
        setInterimText("");
        if (e.error === "not-allowed") {
          const msg = "마이크 접근 권한이 필요합니다.";
          setSttError(msg);
          onError?.(msg);
        } else if (e.error !== "no-speech") {
          const msg = "음성 인식 중 오류가 발생했습니다.";
          setSttError(msg);
          onError?.(msg);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    },
    [isRecording, lang, onResult, onError, stop]
  );

  const clearError = useCallback(() => setSttError(null), []);

  return { isRecording, interimText, sttError, start, stop, clearError };
}
