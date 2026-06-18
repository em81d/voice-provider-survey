// backend/src/voiceRegistry.ts
//
// Server-only voice catalog. The client never sees this file or its
// contents directly — it only ever learns "your session is ready," never
// which provider or voice was picked.

import type { ProviderType, VoiceRegistry } from "./types";

export const VOICE_REGISTRY: VoiceRegistry = {
  google: [
    { id: "Puck", name: "Puck", desc: "Energetic" },
    { id: "Charon", name: "Charon", desc: "Deep calm" },
    { id: "Kore", name: "Kore", desc: "Balanced" },
  ],
  elevenlabs: [
    { id: "e0LG5Mpq7SLRdJvrtmcJ", name: "grandma", desc: "new old lady friend" },
    { id: "dag0x2dW9i5XIWwJ5KlD", name: "chxpo", desc: "cool guy" },
    { id: "JaagUurP1dmW3WscoJ79", name: "dahlia", desc: "intriguing gal" },
  ],
  hume: [
    { id: "ee96fb5f-ec1a-4f41-a9ba-6d119e64c8fd", name: "vince", desc: "vince!" },
    { id: "59cfc7ab-e945-43de-ad1a-471daa379c67", name: "kora", desc: "annoying tiktok girl"},
    { id: "f60ecf9e-ff1e-4bae-9206-dba7c653a69e", name: "ito", desc: "a normal sounding guy" }
  ],
};

export const PROVIDERS: ProviderType[] = Object.keys(VOICE_REGISTRY) as ProviderType[];

// Flat list of every (provider, voice) pair — the actual unit of
// randomization. If you want voice-level balance rather than provider-level
// (so Hume's single voice doesn't get picked 3x less often than Google's
// four), this is the list to weight or dedupe against later.
export function allVoiceOptions(): { provider: ProviderType; voice: VoiceRegistry[ProviderType][number] }[] {
  return PROVIDERS.flatMap((provider) =>
    VOICE_REGISTRY[provider].map((voice) => ({ provider, voice }))
  );
}