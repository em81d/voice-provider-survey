// frontend/src/hooks/useVoiceSocket.ts
//
// Extracted from AIChat.tsx's mic-capture / WS-relay / queued-playback
// logic, with the provider/voice picker removed entirely. The caller gets
// a token from POST /api/session/start and never learns what's behind it.

import { useRef, useState, useCallback } from "react";
import type { ServerToClientMessage, ConnectionState, WaveLevel, TranscriptMessage } from "../types/ws";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://localhost:5000";
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:5000";

// Close code the backend sends when a token is missing, unknown, or
// already used — see CLOSE_INVALID_TOKEN in backend/src/server.ts.
const CLOSE_INVALID_TOKEN = 4001;

// Fallback only used if audio somehow arrives before a 'session_config'
// frame (shouldn't happen given backend ordering, but better than silently
// guessing the device's native rate via a bare `new AudioContext()`).
const DEFAULT_SAMPLE_RATE = 24000;

export function useVoiceSocket() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [waveLevel, setWaveLevel] = useState<WaveLevel>("idle");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const sampleRateRef = useRef<number>(DEFAULT_SAMPLE_RATE);

  // ── Cleanup ────────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    activeAudioNodesRef.current.forEach((node) => { try { node.stop(); } catch { /* already ended */ } });
    activeAudioNodesRef.current = [];
    if (playbackContextRef.current) {
      if (playbackContextRef.current.state !== "closed") playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    // Don't let this session's rate leak into the next one. If a future
    // provider's backend code ever forgets to send 'session_config' before
    // its first chunk, we want a known default, not whatever the previous
    // call happened to leave behind.
    sampleRateRef.current = DEFAULT_SAMPLE_RATE;
  }, []);

  const cleanupUIState = useCallback(() => {
    setConnectionState("idle");
    setWaveLevel("idle");
  }, []);

  const disconnect = useCallback(() => {
    stopRecording();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupUIState();
  }, [stopRecording, cleanupUIState]);

  // ── Downsampling (unchanged from AIChat.tsx) ──────────────────────────

  const downsampleBuffer = (buffer: Float32Array, fromRate: number, toRate: number): Float32Array => {
    if (fromRate === toRate) return buffer;
    if (fromRate < toRate) return buffer;
    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };

  // ── Mic capture ────────────────────────────────────────────────────────

  const startRecording = useCallback(async (socket: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, e.inputBuffer.sampleRate, 16000);
        const pcmBuffer = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const s = Math.max(-1, Math.min(1, downsampled[i]));
          pcmBuffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        socket.send(pcmBuffer.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("Microphone init failed:", err);
      setErrorMessage("Microphone access denied or audio initialization failed.");
      disconnect();
    }
  }, [disconnect]);

  // ── Playback context setup ────────────────────────────────────────────

  // Builds (or rebuilds) the playback AudioContext at the exact sample rate
  // the backend told us to expect, instead of letting the browser pick its
  // native device rate. Letting it default meant every chunk got an
  // independent, lossy resample from sampleRateRef -> native rate, which is
  // what produced the tinny/pitch-wobbling audio — especially noticeable on
  // Gemini's many small chunks.
  const initPlaybackContext = useCallback((rate: number) => {
    // Stop and clear any nodes scheduled against the old context — they
    // can't be carried over to a new one.
    activeAudioNodesRef.current.forEach((node) => { try { node.stop(); } catch { /* already ended */ } });
    activeAudioNodesRef.current = [];

    if (playbackContextRef.current && playbackContextRef.current.state !== "closed") {
      playbackContextRef.current.close();
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    try {
      playbackContextRef.current = new AudioContextClass({ sampleRate: rate });
    } catch {
      // Some browsers reject arbitrary sampleRate values — fall back to
      // native and accept the resample rather than failing outright.
      console.warn(`AudioContext rejected sampleRate=${rate}; falling back to device default.`);
      playbackContextRef.current = new AudioContextClass();
    }
    nextStartTimeRef.current = playbackContextRef.current.currentTime;
  }, []);

  // ── Playback ───────────────────────────────────────────────────────────

  const handleIncomingAudioChunk = useCallback(async (arrayBuffer: ArrayBuffer) => {
    try {
      if (!playbackContextRef.current) {
        // Shouldn't happen given backend ordering (session_config always
        // precedes the first audio chunk), but guard against it rather than
        // silently defaulting to the device's native rate.
        console.warn("Audio chunk arrived before session_config; initializing playback context with default rate.");
        initPlaybackContext(sampleRateRef.current);
      }
      const ctx = playbackContextRef.current!;
      if (ctx.state === "suspended") await ctx.resume();

      // Int16Array requires an even byte length. A chunk boundary that
      // splits a 16-bit sample would otherwise throw and silently drop the
      // whole chunk — trim the stray trailing byte instead so we only lose
      // a single sample, not the whole buffer.
      let buf = arrayBuffer;
      if (buf.byteLength % 2 !== 0) {
        console.warn(`Audio chunk had odd byte length (${buf.byteLength}); dropping trailing byte.`);
        buf = buf.slice(0, buf.byteLength - 1);
      }

      const int16Array = new Int16Array(buf);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768.0;

      const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRateRef.current);
      audioBuffer.copyToChannel(float32Array, 0);

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      setWaveLevel("active");
      sourceNode.connect(ctx.destination);
      activeAudioNodesRef.current.push(sourceNode);

      if (nextStartTimeRef.current < ctx.currentTime) nextStartTimeRef.current = ctx.currentTime;
      sourceNode.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

      sourceNode.onended = () => {
        activeAudioNodesRef.current = activeAudioNodesRef.current.filter((n) => n !== sourceNode);
        if (activeAudioNodesRef.current.length === 0) setWaveLevel("idle");
      };
    } catch (err) {
      console.error("Error scheduling audio playback:", err);
    }
  }, [initPlaybackContext]);

  const handleUserInterruption = useCallback(() => {
    activeAudioNodesRef.current.forEach((node) => { try { node.stop(); } catch { /* already ended */ } });
    activeAudioNodesRef.current = [];
    if (playbackContextRef.current) nextStartTimeRef.current = playbackContextRef.current.currentTime;
  }, []);

  // ── Connect / disconnect ──────────────────────────────────────────────

  const connect = useCallback(async () => {
    setErrorMessage(null);
    setConnectionState("connecting");
    setWaveLevel("loading");

    try {
      // 1. Get a token — provider/voice are decided server-side and never sent here.
      const startRes = await fetch(`${API_BASE}/api/session/start`, { method: "POST" });
      if (!startRes.ok) throw new Error("Could not start a session. Please try again.");
      const { token } = (await startRes.json()) as { token: string };
      setToken(token);

      // 2. Open the relay socket, identified only by that token.
      const socket = new WebSocket(`${WS_BASE}/stream?token=${token}`);
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onopen = () => {
        setConnectionState("active");
        setWaveLevel("active");
        startRecording(socket);
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          handleIncomingAudioChunk(event.data);
          return;
        }
        try {
          const data = JSON.parse(event.data) as ServerToClientMessage;

          if (data.type === "session_config") {
            sampleRateRef.current = data.sampleRate;
            // Rebuild the playback context at the actual announced rate so
            // chunks play back without per-chunk resampling.
            initPlaybackContext(data.sampleRate);
            return;
          }
          if (data.type === "text") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.sender === "ai") {
                return [...prev.slice(0, -1), { ...last, text: last.text + data.payload }];
              }
              return [...prev, { id: crypto.randomUUID(), sender: "ai", text: data.payload, timestamp: new Date() }];
            });
          }
          if (data.type === "user_transcript") {
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), sender: "user", text: data.payload, timestamp: new Date() }]);
          }
          if (data.type === "interrupted") {
            handleUserInterruption();
          }
          if (data.type === "error") {
            setErrorMessage(data.message);
          }
        } catch {
          // Non-JSON, non-ArrayBuffer frame — ignore.
        }
      };

      socket.onerror = () => {
        setErrorMessage("Connection error. Please try again.");
      };

      socket.onclose = (event) => {
        if (event.code === CLOSE_INVALID_TOKEN) {
          setErrorMessage("Your session expired or was already used. Please refresh and start again.");
        }
        cleanupUIState();
      };
    } catch (err: any) {
      setErrorMessage(err.message ?? "Could not reach the server.");
      cleanupUIState();
    }
  }, [startRecording, handleIncomingAudioChunk, handleUserInterruption, cleanupUIState, initPlaybackContext]);

  const toggleConnection = useCallback(() => {
    if (connectionState === "active" || connectionState === "connecting") {
      disconnect();
    } else {
      connect();
    }
  }, [connectionState, connect, disconnect]);

  return { connectionState, waveLevel, messages, errorMessage, toggleConnection, token };
}