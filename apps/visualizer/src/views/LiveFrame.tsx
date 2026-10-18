import { useEffect, useState } from 'react';

/** What the persona heard since its last snapshot, already through its ears. */
interface HeardSound {
  heard: string;
  wav_b64: string | null;
}

interface FrameMeta {
  snapshot: number;
  audio: HeardSound[];
}

/**
 * Pixel-identical view of what the agent's model saw: a direct WebSocket to
 * that agent-persona's frame endpoint (never via the driver). One at a time.
 */
export function LiveFrame({ endpoint }: { endpoint: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [heard, setHeard] = useState<string[]>([]);

  useEffect(() => {
    if (!endpoint) return;
    const ws = new WebSocket(`ws://${endpoint}`);
    ws.binaryType = 'blob';
    const ctx = new AudioContext();
    let url: string | null = null;
    let played = -1;
    let queue = Promise.resolve();
    ws.onmessage = (ev: MessageEvent<Blob | string>) => {
      if (typeof ev.data === 'string') {
        const meta = JSON.parse(ev.data) as FrameMeta;
        setHeard(meta.audio.map((a) => a.heard));
        // Each snapshot is published twice (before and after planning); play it once.
        if (meta.snapshot !== played) {
          played = meta.snapshot;
          for (const { wav_b64: wav } of meta.audio) {
            if (wav) queue = queue.then(() => play(ctx, wav)).catch(() => undefined);
          }
        }
        return;
      }
      const next = URL.createObjectURL(ev.data);
      if (url) URL.revokeObjectURL(url);
      url = next;
      setSrc(next);
    };
    return () => {
      ws.close();
      void ctx.close();
      if (url) URL.revokeObjectURL(url);
      setSrc(null);
      setHeard([]);
    };
  }, [endpoint]);

  if (!endpoint) return null;
  return (
    <figure className="frame">
      {src ? (
        <img src={src} alt="What this persona sees" />
      ) : (
        <span className="frame-empty">connecting</span>
      )}
      {heard.length > 0 && <figcaption>heard {heard.join('; ')}</figcaption>}
    </figure>
  );
}

async function play(ctx: AudioContext, wavB64: string): Promise<void> {
  const bytes = Uint8Array.from(atob(wavB64), (c) => c.charCodeAt(0));
  const buffer = await ctx.decodeAudioData(bytes.buffer);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  await new Promise<void>((resolve) => {
    source.onended = () => {
      resolve();
    };
    source.start();
  });
}
