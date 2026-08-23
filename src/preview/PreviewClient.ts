export interface PreviewSelection {
  chart_id: string;
  start_seconds?: number;
}

interface PreviewCommand {
  type: "select_preview";
  requestId: number;
  chartId: string;
  startSeconds: number;
}

export class PreviewClient {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pending_command: PreviewCommand | null = null;
  private request_id = 0;

  async connect(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
    const connection = new RTCPeerConnection();
    this.connection = connection;
    connection.addTransceiver("audio", { direction: "recvonly" });
    connection.ontrack = (event) => {
      setMinimumJitterBuffer(event.receiver);
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => undefined);
    };

    const channel = connection.createDataChannel("preview-control", { ordered: true });
    this.channel = channel;
    channel.onopen = () => this.flushSelection();

    await connection.setLocalDescription(await connection.createOffer());
    await waitForIceGathering(connection, signal);
    const local_description = connection.localDescription;
    if (!local_description) {
      throw new Error("Failed to create preview SDP offer");
    }

    const response = await fetch("/api/preview/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local_description),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Preview signaling failed: ${response.status} ${response.statusText}`);
    }

    const answer = await response.json() as RTCSessionDescriptionInit;
    await connection.setRemoteDescription(answer);
    for (const receiver of connection.getReceivers()) setMinimumJitterBuffer(receiver);
  }

  select(selection: PreviewSelection): void {
    for (const receiver of this.connection?.getReceivers() ?? []) setMinimumJitterBuffer(receiver);
    this.pending_command = {
      type: "select_preview",
      requestId: ++this.request_id,
      chartId: selection.chart_id,
      startSeconds: selection.start_seconds ?? 0,
    };
    this.flushSelection();
  }

  close(): void {
    this.channel?.close();
    this.connection?.close();
    this.channel = null;
    this.connection = null;
    this.pending_command = null;
  }

  private flushSelection(): void {
    if (this.channel?.readyState !== "open" || !this.pending_command) {
      return;
    }

    this.channel.send(JSON.stringify(this.pending_command));
    this.pending_command = null;
  }
}

function setMinimumJitterBuffer(receiver: RTCRtpReceiver): void {
  const configurable_receiver = receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number;
    playoutDelayHint?: number;
  };
  try {
    if ("jitterBufferTarget" in configurable_receiver) configurable_receiver.jitterBufferTarget = 0;
    if ("playoutDelayHint" in configurable_receiver) configurable_receiver.playoutDelayHint = 0;
  } catch {
    // Experimental receiver hints may be exposed as read-only by some browsers.
  }
}

function waitForIceGathering(connection: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (connection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      connection.removeEventListener("icegatheringstatechange", onStateChange);
      signal.removeEventListener("abort", onAbort);
    };
    const onStateChange = () => {
      if (connection.iceGatheringState === "complete") {
        finish();
        resolve();
      }
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Preview connection aborted", "AbortError"));
    };
    connection.addEventListener("icegatheringstatechange", onStateChange);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
