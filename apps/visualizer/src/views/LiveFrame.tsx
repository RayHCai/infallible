import { useEffect, useState } from 'react';

/**
 * Pixel-identical view of what the agent's model saw: a direct WebSocket to
 * that agent-persona's frame endpoint (never via the driver). One at a time.
 */
export function LiveFrame({ endpoint }: { endpoint: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [audio, setAudio] = useState<string[]>([]);

  useEffect(() => {
    if (!endpoint) return;
    const ws = new WebSocket(`ws://${endpoint}`);
    ws.binaryType = 'blob';
    let url: string | null = null;
    ws.onmessage = (ev: MessageEvent<Blob | string>) => {
      if (typeof ev.data === 'string') {
        setAudio((JSON.parse(ev.data) as { audio: string[] }).audio);
        return;
      }
      const next = URL.createObjectURL(ev.data);
      if (url) URL.revokeObjectURL(url);
      url = next;
      setSrc(next);
    };
    return () => {
      ws.close();
      if (url) URL.revokeObjectURL(url);
      setSrc(null);
      setAudio([]);
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
      {audio.length > 0 && <figcaption>heard {audio.join(', ')}</figcaption>}
    </figure>
  );
}
