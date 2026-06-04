// Offscreen document: plays a gentle chime via Web Audio API
// Runs in response to PLAY_CHIME messages from the background service worker.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PLAY_CHIME') playChime();
});

function playChime() {
  try {
    const ctx = new AudioContext();
    // Soft ascending triad: C5 → E5 → G5
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      osc.start(t);
      osc.stop(t + 1.0);
    });
  } catch (_) {
    // Ignore — audio context may be blocked in some environments
  }
}
