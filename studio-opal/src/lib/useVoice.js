import { useRef, useState } from "react";
import { speakWithGemini } from "./ai";
import { plainForSpeech } from "./util";

export function useVoice(settings, onNotice) {
  const [playing, setPlaying] = useState(null);
  const [busy, setBusy] = useState(null);
  const audioRef = useRef(null);
  const cache = useRef(new Map());

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setPlaying(null);
  };

  const playUrl = (url, id) => {
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlaying((p) => (p === id ? null : p));
    a.onerror = () => setPlaying(null);
    setPlaying(id);
    a.play().catch(() => setPlaying(null));
  };

  const browserSpeak = (text, id) => {
    if (!("speechSynthesis" in window)) { onNotice?.("This browser can't read text aloud."); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setPlaying((p) => (p === id ? null : p));
    setPlaying(id);
    window.speechSynthesis.speak(u);
  };

  const play = async (id, raw) => {
    if (playing === id) { stop(); return; }
    stop();
    const text = plainForSpeech(raw).slice(0, 4000);
    if (!text) return;
    const key = `${settings.voice}|${raw}`;
    if (cache.current.has(key)) { playUrl(cache.current.get(key), id); return; }
    if (!settings.keys.gemini) { browserSpeak(text, id); return; }
    setBusy(id);
    try {
      const blob = await speakWithGemini({ key: settings.keys.gemini, model: settings.ttsModel, voice: settings.voice, text });
      const url = URL.createObjectURL(blob);
      cache.current.set(key, url);
      setBusy(null);
      playUrl(url, id);
    } catch (e) {
      setBusy(null);
      onNotice?.("Gemini voice isn't available on your key, so your browser's voice is reading instead.");
      browserSpeak(text, id);
    }
  };

  return { play, stop, playing, busy };
}
