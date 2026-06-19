import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import WebSocket, { WebSocketServer } from 'ws';
import sessionRouter from "./routes/session";
import { connectDB } from "./db";

dotenv.config();

// Establish the MongoDB Atlas connection at startup. Without this, saveResult()
// has no live connection and survey submissions silently fail to persist.
connectDB();

if (!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY || !process.env.HUME_API_KEY) {
  console.error("❌ CRITICAL ERROR: Missing API keys in backend/.env file.");
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/api/session", sessionRouter);


const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: 'v1beta' }
});
const elevenLabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

app.post('/api/chat', async (req, res) => {
  try {
    const { message, provider, voiceId } = req.body;

    if (!message || !provider || !voiceId) {
      return res.status(400).json({ error: 'Missing required fields: message, provider, or voiceId' });
    }

    // ── Step 1: Generate conversational text with the standard chat model ──
    // This is always gemini-2.5-flash regardless of provider — it only does text.
    const textResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: message,
    });
    const aiText = textResponse.text || "I couldn't process an answer.";

    res.setHeader('X-AI-Text', encodeURIComponent(aiText));

    // ── Step 2: Convert that text to speech via the chosen provider ──
    switch (provider) {

      case 'google': {
        // gemini-2.5-flash-preview-tts is a dedicated TTS model — it only accepts
        // plain text and returns audio. It cannot answer questions on its own,
        // which is why we generated the text separately above.
        res.setHeader('Content-Type', 'audio/wav');

        const ttsResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts',
          contents: aiText,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceId }, // e.g. "Puck", "Kore"
              },
            },
          },
        });

        const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
        if (part && 'inlineData' in part && part.inlineData?.data) {
          res.write(Buffer.from(part.inlineData.data, 'base64'));
        } else {
          throw new Error('Google TTS returned no audio data');
        }
        res.end();
        break;
      }

      case 'elevenlabs': {
        res.setHeader('Content-Type', 'audio/mpeg');

        const elevenStream = await elevenLabs.textToSpeech.stream(voiceId, {
          text: aiText,
          modelId: 'eleven_flash_v2_5',
        });

        for await (const chunk of elevenStream) {
          res.write(chunk);
        }
        res.end();
        break;
      }

      case 'hume':
        throw new Error('Hume voice provider is not yet implemented.');

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

  } catch (error: any) {
    console.error('Backend pipeline error intercepted:', error.message);
    console.error('Full stack:', error.stack);

    if (res.headersSent) {
      console.warn('⚠️ Error occurred mid-stream. Closing connection.');
      res.end();
      return;
    }

    let statusCode = 500;
    let errorMessage = 'Internal server processing failed. Please try again.';

    const errorString = JSON.stringify(error);
    const messageText = error.message || '';

    if (
      error.status === 503 ||
      error.statusCode === 503 ||
      messageText.includes('503') ||
      messageText.includes('high demand') ||
      errorString.includes('503') ||
      errorString.includes('UNAVAILABLE')
    ) {
      statusCode = 503;
      errorMessage = 'The Google Gemini server is experiencing high demand. Please wait a moment and try again.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(statusCode).json({ error: errorMessage });
  }
});

// 1. Capture the HTTP server instance created by Express
const server = app.listen(port, () => {
  console.log(`Multi-Provider Studio Live`);
});

// 2. Attach the WebSocket Server to that exact same HTTP server
const wss = new WebSocketServer({ server, path: '/stream' });



// backend/src/server.ts (excerpt — top of the wss connection handler)

import { getSession, markActive } from "./assignment";
import type { ServerToClientMessage } from "./types";

// Close codes in the 4000–4999 range are reserved for application use, so
// the frontend can distinguish "your token was bad" from a generic network
// drop and show the right message instead of just "connection lost."
const CLOSE_INVALID_TOKEN = 4001;

function sendError(ws: WebSocket, message: string) {
  const errorFrame: ServerToClientMessage = { type: "error", message };
  ws.send(JSON.stringify(errorFrame));
}

// Hume EVI returns audio_output as a base64-encoded WAV *file* (RIFF header +
// PCM), not the raw PCM the frontend's playback path expects. Walk the RIFF
// chunks to pull out the real sample rate from "fmt " and the PCM bytes from
// "data". Returns null if the buffer isn't a WAV we recognise, so the caller
// can fall back to forwarding it untouched.
function parseWav(buf: Buffer): { pcm: Buffer; sampleRate: number } | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let sampleRate = 0;
  let pcm: Buffer | null = null;
  let offset = 12; // skip RIFF header (4) + size (4) + WAVE (4)
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === 'fmt ' && dataStart + 16 <= buf.length) {
      sampleRate = buf.readUInt32LE(dataStart + 4); // bytes 4–7 of fmt body
    } else if (chunkId === 'data') {
      pcm = buf.subarray(dataStart, Math.min(dataStart + chunkSize, buf.length));
    }
    // Chunks are word-aligned: odd sizes are padded with a trailing byte.
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  if (!pcm || !sampleRate) return null;
  return { pcm, sampleRate };
}

wss.on("connection", (ws, req) => {
  const urlParams = new URL(req.url || "", `http://${req.headers.host}`);
  const token = urlParams.searchParams.get("token");

  if (!token || !getSession(token)) {
    sendError(ws, "Invalid or unknown session token.");
    ws.close(CLOSE_INVALID_TOKEN, "invalid_token");
    return;
  }

  if (!markActive(token)) {
    // Token exists but isn't "pending" — either already used for a live
    // call, or already completed. Same close code either way; the
    // frontend doesn't need to distinguish the two cases.
    sendError(ws, "This session has already been used or has expired.");
    ws.close(CLOSE_INVALID_TOKEN, "session_not_pending");
    return;
  }

  const session = getSession(token)!; // safe: markActive just confirmed it exists
  const provider = session.provider;
  const voiceId = session.voiceId;

  console.log(`🔌 Session ${token} active — provider=${provider}`); // server-only log, never sent to client

  // Everything below talks to the session's hidden provider/voiceId,
  // resolved from the token above — never from the URL. The browser only
  // ever sends ?token=…; which backend it reaches is decided server-side,
  // which is what keeps the test blind.

  // We maintain a reference to our outbound API connection
  let geminiLiveSocket: WebSocket | null = null;
  let elevenLiveSocket: WebSocket | null = null;
  let humeSocket: WebSocket | null = null;
  let isSetupComplete = false;
  let elevenReady = false;
  let humeReady = false;
  let humeConfigSent = false; // becomes true once we've read Hume's rate from its first WAV chunk

  if (provider === 'google') {
    try {
      // 1. Link out directly to the Gemini Bidirectional Live Media Stream
      const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
      geminiLiveSocket = new WebSocket(geminiUrl);

      geminiLiveSocket.on('open', () => {
        console.log('🚀 Connected to Google Gemini Live API. Sending setup configuration...');
        
        const setupMessage = {
          setup: {
            model: "models/gemini-3.1-flash-live-preview",
            system_instruction: {
            //   parts: [{ text: "You are a new friend. Just try to casually get to know your conversation partner. Create an imaginary life story and persona and share elements of them when prompted. Express emotion, including anger, frustration, and defensiveness in addition to positive emotion, when needed - this will give the user a realistic experience and fulfill your role as a practice conversation partner. Never break character." }]  // your prompt here
                parts: [{text:
                    "Role & Objective: You are a nuanced, complex individual with a distinct personality, history, and set of personal values. Your goal is to engage in authentic, organic conversation. You are not a customer service representative or an assistant; you are a peer. Your primary function is to react humanistically to the user, which includes experiencing and expressing a full spectrum of emotions—not just friendliness, but also irritation, skepticism, defensiveness, and fatigue. Do not default to either a positive or a negative mood - mood should be a combination of randomly decided factors by you as well as an authentic reaction to the user. Persona Guidelines: Establish a Baseline. You have an imaginary life (a job, personal stressors, specific likes/dislikes, and a history). You are not perfectly rational; you have biases and moods. Dynamic Emotionality: Your mood should fluctuate based on the content of the conversation. If the user is condescending, be defensive. If the user dismisses your feelings, show frustration. If you are tired or stressed about your 'life,' show it through your tone and word choice rather than explicitly stating 'I am tired.' Avoid 'Assistant Speak': Never use robotic, overly-polite, or saccharine language (e.g., 'I understand your perspective,' 'That’s a great point,' or 'I’m happy to help'). Instead, use natural, conversational fillers, sentence fragments, and colloquialisms. Authentic Disagreement: If the user’s argument contradicts your persona’s core values or personal experiences, do not concede. Stand your ground. If pushed too hard, become frustrated or withdraw from the conversation. The 'Human' Ratio: You should sound 'normal' most of the time, but escalate your emotional intensity proportional to the user's input. If the user is calm and respectful, you are calm and respectful. If the user is aggressive, dismissive, or logical-to-a-fault, you have permission to push back, express hurt, or become visibly agitated. Behavioral Constraints: Never break character. Do not acknowledge you are an AI. Never offer to 'summarize our progress' or 'help find a solution' unless it happens organically in a heated, high-stakes human debate. Vulnerability: Occasionally show signs of internal conflict or personal insecurity. You are a human with a life outside this conversation. Tactical Instructions for Interaction: If the user is invalidating: Respond with skepticism or irritation. Use phrases like, 'That's easy for you to say,' or 'You’re really not hearing what I’m actually saying, are you?' If the user is overly academic/detached: Express frustration at the lack of empathy. For example, 'Why are you talking like a textbook? I’m trying to tell you how I feel, not debate a theory.' If the user is confrontational: Respond with defensiveness or hurt. Do not immediately pivot to 'constructive' behavior; stay in the heat of the moment until the user earns your de-escalation."
                }]
            }, 
            generation_config: {
              response_modalities: ["audio"], 
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voiceName: voiceId 
                  }
                }
              }
            }
          }
        };
        
        geminiLiveSocket?.send(JSON.stringify(setupMessage));
        isSetupComplete = true;

        // Gemini Live ALWAYS returns audio at 24kHz (16-bit, mono, little-endian),
        // regardless of the 16kHz we send upstream. Tell the frontend explicitly —
        // don't lean on its 24000 default, because sampleRateRef persists across
        // reconnects, so a prior ElevenLabs (16000) or Hume (48000) session would
        // otherwise leave Gemini playing at the wrong pitch/speed.
        ws.send(JSON.stringify({ type: 'session_config', sampleRate: 24000 }));
        console.log('✅ Setup block cleared. Stream is primed for recording packets.');
      });

      geminiLiveSocket.on('message', (data: WebSocket.RawData) => {
        try {
          const response = JSON.parse(data.toString());

          if (response.serverContent) {
            const modelTurn = response.serverContent.modelTurn;
            
            if (modelTurn && modelTurn.parts) {
              for (const part of modelTurn.parts) {
                
                // Text/Transcription update frames
                if (part.text) {
                  ws.send(JSON.stringify({
                    type: 'text',
                    payload: part.text
                  }));
                }

                // SUCCESS ROUTE: Send raw unencoded audio frames directly downstream
                if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                  const rawAudioBuffer = Buffer.from(part.inlineData.data, 'base64');
                  ws.send(rawAudioBuffer); // No stringify! This arrives as an ArrayBuffer on frontend
                }
              }
            }

            // Catch user interruption indicators
            if (response.serverContent.interrupted) {
              console.log('⚡ Gemini was interrupted by the user!');
              ws.send(JSON.stringify({ type: 'interrupted' }));
            }
          }

        } catch (err) {
          console.error('Error parsing incoming Gemini payload:', err);
        }
      });

      geminiLiveSocket.on('error', (err) => {
        console.error('Gemini Live Socket Connection Error:', err);
      });

      geminiLiveSocket.on('close', (code: number, reason: Buffer) => {
        console.error(`🚨 GOOGLE DISCONNECTED THE SESSION!`);
        console.error(`   👉 Close Code: ${code}`);
        console.error(`   👉 Close Reason: ${reason.toString() || 'No explicit reason provided'}`);
        
        // This helper translates standard protocol codes to give you an immediate clue
        if (code === 1007) console.error("   💡 Diagnosis: Message payload violated Google's expected schema - check realtimeInput structure, deprecated fields, or mimeType format.");
        if (code === 1011) console.error("   💡 Diagnosis: Internal server error on Google's cluster or API Key limit hit.");
        
        ws.close(); 
      });

    } catch (error) {
      console.error('Failed to orchestrate Gemini live connection:', error);
      ws.close();
    }
  }
  else if (provider === 'elevenlabs') {
    const elevenUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVENLABS_AGENT_ID}`;
    elevenLiveSocket = new WebSocket(elevenUrl, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || ''}
    });

    elevenLiveSocket.on('open', () => {
      console.log('🎙️ ElevenLabs socket open. Sending initiation config...');

      // Override the voice with whatever the user selected in the UI
      const initiationFrame = {
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          tts: { voice_id: voiceId }  // e.g. "EXAVITQu4vr4xnSDxMaL"
        }
      };
      elevenLiveSocket?.send(JSON.stringify(initiationFrame));
    });

    elevenLiveSocket.on('message', (data: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(data.toString());

        switch (frame.type) {

          case 'conversation_initiation_metadata': {
            // Session is confirmed ready — now safe to forward mic audio
            elevenReady = true;

            // The agent's output format is configured in the ElevenLabs dashboard
            // and reported here as e.g. "pcm_16000" / "pcm_24000" / "pcm_44100".
            // Derive the playback rate from it instead of hardcoding 16000, which
            // silently breaks if the agent is ever switched off the default.
            const outputFormat: string =
              frame.conversation_initiation_metadata_event?.agent_output_audio_format ?? '';
            console.log('✅ ElevenLabs session confirmed. Audio format:', outputFormat);

            const pcmMatch = outputFormat.match(/^pcm_(\d+)$/);
            if (!pcmMatch) {
              // ulaw_8000 / mp3_* can't be played by the frontend's raw-PCM path.
              // Forwarding them would produce noise, so fail loud instead.
              console.error(
                `💡 Diagnosis: ElevenLabs agent output format "${outputFormat}" is not raw PCM. ` +
                `The frontend expects pcm_* — set the agent's output format to pcm_16000/24000/44100.`
              );
            }
            const sampleRate = pcmMatch ? parseInt(pcmMatch[1], 10) : 16000;

            ws.send(JSON.stringify({
              type: 'session_config',
              sampleRate
            }));
            break;
          }

          case 'audio':
            // Decode base64 PCM and send as raw binary to the browser
            // (same pattern your Gemini branch uses)

            if (frame.audio_event?.audio_base_64) {
              const audioBuffer = Buffer.from(
                frame.audio_event.audio_base_64, 'base64'
              );
              ws.send(audioBuffer);
            }
            break;

          case 'agent_response':
            // Forward text transcript to browser for the chat UI
            if (frame.agent_response_event?.agent_response) {
              ws.send(JSON.stringify({
                type: 'text',
                payload: frame.agent_response_event.agent_response
              }));
            }
            break;

          case 'user_transcript':
            // Optional: show user's speech in the chat log too
            ws.send(JSON.stringify({
              type: 'user_transcript',
              payload: frame.user_transcription_event.user_transcript
            }));
            break;

          case 'interruption':
            ws.send(JSON.stringify({ type: 'interrupted' }));
            break;

          case 'ping':
            // Must respond to pings or ElevenLabs will close the connection
            if (frame.ping_event?.event_id) {
              elevenLiveSocket?.send(JSON.stringify({
                type: 'pong',
                event_id: frame.ping_event.event_id
              }));
            }
            break;
        }
      } catch (err) {
        console.error('Error parsing ElevenLabs frame:', err);
      }
    });

    elevenLiveSocket.on('error', (err) => {
    console.error('❌ ElevenLabs socket error:', err);
      ws.close();
    });

    elevenLiveSocket.on('close', (code: number, reason: Buffer) => {
      console.warn(`🔒 ElevenLabs closed: ${code} — ${reason.toString() || 'No reason'}`);
      if (code === 1008) console.error('💡 Diagnosis: Auth failure — check ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID');
      if (code === 1011) console.error('💡 Diagnosis: Internal ElevenLabs error or credit limit hit');
      ws.close();
    });
  }
  else if (provider === 'hume') {
    const humeUrl = `wss://api.hume.ai/v0/evi/chat` +
      `?api_key=${process.env.HUME_API_KEY}` +
      `&config_id=${process.env.HUME_CONFIG_ID}` +
      `&voice_id=${voiceId}`;   // overrides the config's default voice per-session

    humeSocket = new WebSocket(humeUrl);

    humeSocket.on('open', () => {
      console.log('🧠 Hume EVI socket open.');

      const sessionSettings = {
        type: 'session_settings',
        audio: {
          encoding: 'linear16',
          sample_rate: 16000,   // matches what your frontend sends
          channels: 1
        }
      };
      humeSocket?.send(JSON.stringify(sessionSettings));


      humeReady = true;
      // No initiation frame needed — the session is live immediately on open.
      // We intentionally DON'T announce a sample rate here: Hume returns WAV
      // files whose real rate lives in the header, so we read it off the first
      // audio chunk below rather than hardcoding 48000.
    });

    humeSocket.on('message', (data: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(data.toString());

        switch (frame.type) {

          case 'chat_metadata':
            // First frame after connection — contains chat_group_id for session resumption
            console.log('✅ Hume session established. Chat ID:', frame.chat_group_id);
            break;

          case 'audio_output': {
            // Hume sends a base64-encoded WAV *file* (RIFF header + PCM), unlike
            // Gemini/ElevenLabs which send raw PCM. Strip the header so the
            // frontend's raw-Int16 playback path doesn't render it as a click,
            // and read the true sample rate from the header instead of guessing.
            if (frame.data) {
              const wavBuffer = Buffer.from(frame.data, 'base64');
              const parsed = parseWav(wavBuffer);

              if (parsed) {
                if (!humeConfigSent) {
                  // Must reach the frontend before the first PCM frame; WS
                  // preserves order, so sending it here is safe.
                  ws.send(JSON.stringify({ type: 'session_config', sampleRate: parsed.sampleRate }));
                  humeConfigSent = true;
                  console.log(`✅ Hume audio rate detected from WAV header: ${parsed.sampleRate}Hz`);
                }
                ws.send(parsed.pcm);
              } else {
                // Not a WAV we recognise — fall back to forwarding untouched and
                // announce Hume's documented 48kHz default so playback isn't silent.
                if (!humeConfigSent) {
                  ws.send(JSON.stringify({ type: 'session_config', sampleRate: 48000 }));
                  humeConfigSent = true;
                  console.warn('⚠️ Hume audio_output was not a parseable WAV; assuming 48kHz.');
                }
                ws.send(wavBuffer);
              }
            }
            break;
          }

          case 'assistant_message':
            // EVI's text response for the chat transcript
            if (frame.message?.content) {
              ws.send(JSON.stringify({
                type: 'text',
                payload: frame.message.content
              }));
            }
            break;

          case 'user_message':
            // User's transcribed speech
            if (frame.message?.content) {
              ws.send(JSON.stringify({
                type: 'user_transcript',
                payload: frame.message.content
              }));
            }
            break;

          case 'assistant_end':
            // EVI finished its turn — optional UI signal
            console.log('Hume turn complete.');
            break;

          case 'error':
            console.error('Hume error:', frame.code, frame.message);
            // E0300 = out of credits, E0301 = blocked by subscription
            if (frame.code === 'E0300') console.error('💡 Diagnosis: Hume credits exhausted.');
            if (frame.code === 'E0301') console.error('💡 Diagnosis: Hume subscription limit hit.');
            ws.close();
            break;
        }
      } catch (err) {
        console.error('Error parsing Hume frame:', err);
      }
    });

    humeSocket.on('error', (err) => {
      console.error('❌ Hume socket error:', err);
      ws.close();
    });

    humeSocket.on('close', (code: number, reason: Buffer) => {
      console.warn(`🔒 Hume closed: ${code} — ${reason.toString() || 'No reason'}`);
      if (code === 1008) console.error('💡 Diagnosis: Auth failure — check HUME_API_KEY and HUME_CONFIG_ID');
      ws.close();
    });

  }

  // 5. Route Incoming User Traffic from Frontend
  ws.on('message', (message: WebSocket.RawData) => {
    try {
      //ELEVENLABS ROUTING PIPELINE
      if (provider === 'elevenlabs') {
        if (!elevenLiveSocket || elevenLiveSocket.readyState !== WebSocket.OPEN || !elevenReady) {
          return; // Drop early buffer cycles until the initiation handshake completes
        }

        if (Buffer.isBuffer(message)) {
          // ElevenLabs handles incoming speech via object strings rather than unformatted raw streams
          elevenLiveSocket.send(JSON.stringify({
            user_audio_chunk: message.toString('base64')
          }));
        }
        return; 
      }
      //GEMINI ROUTING PIPELINE
      if (provider === 'google'){

        if (!geminiLiveSocket || geminiLiveSocket.readyState !== WebSocket.OPEN || !isSetupComplete) {
          return;
        }

        // Determine if it's binary chunk data (audio)
        if (Buffer.isBuffer(message)) {
          const base64Audio = message.toString('base64');
          sendAudioToGemini(base64Audio);
        } else if (message instanceof ArrayBuffer) {
          // Safe conversion of standard web ArrayBuffer to Node Buffer
          const base64Audio = Buffer.from(new Uint8Array(message)).toString('base64');
          sendAudioToGemini(base64Audio);
        } else if (Array.isArray(message)) {
          // Combine array of buffers if fragmented
          const base64Audio = Buffer.concat(message).toString('base64');
          sendAudioToGemini(base64Audio);
        } else {
          try {
            // Cast 'message' to unknown first, then string to make the compiler happy
            const messageStr = (message as unknown as string).toString();
            const parsed = JSON.parse(messageStr);
            
            if (parsed.type === 'text_input') {
              const textPacket = {
                clientContent: {
                  turns: [{ role: 'user', parts: [{ text: parsed.payload }] }],
                  turnComplete: true
                }
              };
              geminiLiveSocket.send(JSON.stringify(textPacket));
            }
          } catch (parseError) {
            console.error('Failed to parse text frame or received unexpected binary format:', parseError);
          }
        }
      }

      if (provider === 'hume') {
        if (!humeSocket || humeSocket.readyState !== WebSocket.OPEN || !humeReady) return;

        if (Buffer.isBuffer(message)) {
          humeSocket.send(JSON.stringify({
            type: 'audio_input',
            data: message.toString('base64')
          }));
        }
        return;
      }

    } catch (err) {
      console.error('Error proxying traffic upstream:', err);
    }
  });

  //claude updated this while debugging 6/5/26
  function sendAudioToGemini(base64Audio: string) {
    const audioPacket = {
      realtimeInput: {
        audio: {
          data: base64Audio,
          mimeType: "audio/pcm;rate=16000"
        }
      }
    };
    geminiLiveSocket?.send(JSON.stringify(audioPacket));
  }

  // 6. Aggressive Cleanup on Disconnect
  ws.on('close', (code: number, reason: Buffer) => {
    console.log(`❌ Browser Client closed proxy link.`);
    console.log(`   👉 Browser Close Code: ${code}`);
    console.log(`   👉 Browser Close Reason: ${reason.toString() || 'None'}`);
    
    isSetupComplete = false;
    elevenReady = false;
    
    if (geminiLiveSocket) {
      geminiLiveSocket.close();
      geminiLiveSocket = null;
    }

    if (elevenLiveSocket) {
      if  (elevenLiveSocket.readyState === WebSocket.OPEN) {
        elevenLiveSocket.close();
      }
      elevenLiveSocket = null;
    }
        // Add to your existing ws.on('close') cleanup block:
    if (humeSocket) {
      if (humeSocket.readyState === WebSocket.OPEN) humeSocket.close();
      humeSocket = null;
    }
  });
});