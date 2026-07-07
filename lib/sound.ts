// ==========================================
// 通知音（Web Audio）
// 音声ファイル不要でオシレーターの2音チャイム（ピン・ポン）を鳴らす。
// ブラウザの自動再生制限のため、ユーザー操作（通知音トグルON）の時点で
// unlockAudio() を呼んで AudioContext を起動しておく必要がある
// ==========================================

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// ユーザー操作のタイミングで呼ぶと、以降は操作なしでも音を鳴らせる
export function unlockAudio(): void {
  getCtx()?.resume().catch(() => {});
}

function tone(c: AudioContext, freq: number, start: number, duration: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // クリックノイズ防止のエンベロープ（立ち上げ→減衰）
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration);
}

export function playOrderChime(): void {
  const c = getCtx();
  if (!c) return;
  const play = () => {
    if (c.state !== "running") return; // 未アンロック（ユーザー操作前）なら黙ってスキップ
    const t = c.currentTime;
    tone(c, 880, t, 0.35); // ピン（A5）
    tone(c, 1175, t + 0.18, 0.5); // ポン（D6）
  };
  if (c.state === "suspended") {
    c.resume().then(play).catch(() => {});
  } else {
    play();
  }
}
