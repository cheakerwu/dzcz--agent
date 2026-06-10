/**
 * 通知音效工具
 * 
 * 使用 Web Audio API 生成电子风格的短促音效
 * 无需外部音频文件，纯代码生成
 */

let audioContext: AudioContext | null = null;

/** 获取或创建 AudioContext（懒初始化，需要用户交互后才能播放） */
function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContext();
    }
    // 如果被浏览器挂起（未交互），尝试恢复
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  } catch {
    return null;
  }
}

/**
 * 播放企微消息通知音效
 * 短促的双音电子提示音，符合 点之出众 风格
 */
export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 第一个音：高频短促
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(880, now); // A5
  osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.06); // E6
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.1);

  // 第二个音：稍低，延迟 80ms
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1100, now + 0.08); // ~C#6
  osc2.frequency.exponentialRampToValueAtTime(1650, now + 0.14); // ~G#6
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.12, now + 0.08);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.08);
  osc2.stop(now + 0.2);
}
