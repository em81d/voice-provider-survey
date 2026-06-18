import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import WebSocket, { WebSocketServer } from 'ws';
import sessionRouter from "./routes/session";

dotenv.config();

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
  console.log(`Multi-Provider Studio Live on http://localhost:${port}`);
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

  // ... existing provider branching (google/elevenlabs/hume) goes here,
  // using `provider` and `voiceId` instead of reading them off the URL ...
});

function sendError(ws: WebSocket, message: string) {
  const errorFrame: ServerToClientMessage = { type: "error", message };
  ws.send(JSON.stringify(errorFrame));
}




// 3. Set up the connection heartbeat listener
wss.on('connection', async (ws, req) => {
  console.log('🔌 New client handshaking via WebSocket...');

  // 1. Extract routing parameters from URL (e.g., ws://localhost:5000/?provider=google&voiceId=Kore)
  const urlParams = new URL(req.url || '', `http://${req.headers.host}`);
  const provider = urlParams.searchParams.get('provider') || 'google';
  const voiceId = urlParams.searchParams.get('voiceId') || 'Puck';

  // We maintain a reference to our outbound API connection
  let geminiLiveSocket: WebSocket | null = null;
  let elevenLiveSocket: WebSocket | null = null;
  let humeSocket: WebSocket | null = null;
  let isSetupComplete = false;
  let elevenReady = false;
  let humeReady = false;

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
              parts: [{ text: "You are a new friend. Just try to casually get to know your conversation partner. Create an imaginary life story and persona and share elements of them when prompted. Express emotion, especially anger, when needed, so that the user can have authentic expressions of defensiveness." }]  // your prompt here
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

          case 'conversation_initiation_metadata':
            // Session is confirmed ready — now safe to forward mic audio
            elevenReady = true;
            console.log('✅ ElevenLabs session confirmed. Audio format:',
              frame.conversation_initiation_metadata_event.agent_output_audio_format);
            
            ws.send(JSON.stringify({
              type: 'session_config',
              sampleRate: 16000
            }));
            break;

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
      // No initiation frame needed — the session is live immediately on open
      ws.send(JSON.stringify({ type: 'session_config', sampleRate: 48000 }));
    });

    humeSocket.on('message', (data: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(data.toString());

        switch (frame.type) {

          case 'chat_metadata':
            // First frame after connection — contains chat_group_id for session resumption
            console.log('✅ Hume session established. Chat ID:', frame.chat_group_id);
            break;

          case 'audio_output':
            // Base64-encoded audio chunk — same pattern as ElevenLabs
            if (frame.data) {
              const audioBuffer = Buffer.from(frame.data, 'base64');
              ws.send(audioBuffer);
            }
            break;

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