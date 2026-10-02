let context = null;

const bells = {
  decision: { pitch: 988, peak: 0.5, ring: 1.4, strikes: [0, 0.24], partials: [[1, 1], [2.76, 0.45], [5.4, 0.25]] },
  review: { pitch: 660, peak: 0.18, ring: 1, strikes: [0], partials: [[1, 1], [2.76, 0.2]] },
};

function strike(at, { pitch, peak, ring, partials }, volume) {
  for (const [ratio, level] of partials) {
    const tone = context.createOscillator(), gain = context.createGain(), decay = ring / ratio ** 0.5;
    tone.type = 'sine';
    tone.frequency.setValueAtTime(pitch * ratio, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak * level * volume / 100, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    tone.connect(gain).connect(context.destination);
    tone.start(at);
    tone.stop(at + decay + 0.05);
  }
}

export function playPing(volume, kind = 'decision') {
  if (volume <= 0 || typeof AudioContext === 'undefined') return;
  context ??= new AudioContext();
  context.resume().catch(() => {});
  const bell = bells[kind] ?? bells.decision, start = context.currentTime;
  for (const offset of bell.strikes) strike(start + offset, bell, volume);
}
