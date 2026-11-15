# Keys and prices

Every key the app takes - where to get it and what it opens - and what the paid work costs. The prices are the app's
own tables, the ones every paid press shows before it pays; services change them, so the press is always the word that
counts.

## The keys

All of them are entered on **Admin → API keys** ([The keys](01-getting-started.md#the-keys)).

| Key | Where to get it | What it opens |
|---|---|---|
| **kie.ai** | kie.ai/api-key | The pictures and video chats, the talking head's frames and clips, environments and lookbooks, Suno music and sounds, the agents |
| **Replicate** | replicate.com/account/api-tokens | New Character; pictures and video as a second way; the agents; transcribing sources |
| **ElevenLabs** | elevenlabs.io/app/settings/api-keys | Reading - talking heads and voiceovers; the voices; music from a description, Video to Music, sound effects |
| **Claude (Anthropic)** | console.anthropic.com/settings/keys | Claude as an agent and in the Assistant |
| **Groq** | console.groq.com/keys | Hearing the words for captions and highlights, fast |
| **Cloudflare** | dash.cloudflare.com/profile/api-tokens | R2 - the models fetch your reference pictures and clips from it; the Telegram bot's messages while the app is closed |
| **Pixabay** | pixabay.com/api/docs | The voiceover's stock B-roll |
| **Freesound** | freesound.org/apiv2/apply | SFX → find online… |
| **Telegram bot** | @BotFather in Telegram | Your bot - REFERENCES |
| **OpenRouter** | openrouter.ai/settings/keys | Not used at the moment |

What needs what, at a glance:

| To use | You need |
|---|---|
| The pictures chat, the video chat | kie.ai or Replicate; Cloudflare to attach pictures or clips |
| Talking head | ElevenLabs, kie.ai, Cloudflare and an AI key for the agents |
| Voiceover | ElevenLabs, Pixabay and an AI key for the agents |
| Highlights | An AI key for the agents; Groq or the speech model on this computer |
| New Character | Replicate and Cloudflare |
| New environment, New lookbook | kie.ai and an AI key for the agents |
| New prop | An AI key for the agents |
| Music and sounds | kie.ai (Suno) or ElevenLabs |
| The Assistant | An AI key for the agents |
| REFERENCES | The Telegram bot |

"An AI key for the agents" is any one of kie.ai, Replicate, Claude or OpenRouter with a step on **Admin → AI settings**.

## Pictures

A picture, by the model and its quality (checked 2026-08-20):

| Model | kie.ai | Replicate |
|---|---|---|
| **nano-banana-2** | 1K $0.04 · 2K $0.06 · 4K $0.09 | 1K $0.067 · 2K $0.101 · 4K $0.151 |
| **nano-banana-2-lite** | $0.02 | $0.034 |
| **seedream-4.5** | $0.0325 | $0.04 |
| **gpt-image-2.5-sunburst** | 1K $0.03 · 2K $0.05 · 4K $0.08 | $0.012 - $0.50 by its quality |
| **grok-imagine-image-2** | $0.02 | $0.02 |

**New Character**: the portrait a few cents, the 4K sheet $0.151 (Replicate) or $0.09 (kie.ai). **New environment**,
**New lookbook**: a picture's price, plus the agent's words.

## Video

A second of the clip, by its quality (checked 2026-10-09):

| Model | kie.ai | Replicate |
|---|---|---|
| **Grok classic**, **Grok 1.5** | 480p $0.012 · 720p $0.0225 · 1080p $0.04 | $0.05 (classic) · $0.08 (1.5) |
| **Seedance 2.0 mini** | 480p $0.019 · 720p $0.041 | 480p $0.04 · 720p $0.09 |
| **Seedance 2.0** | 480p $0.095 · 720p $0.205 · 1080p $0.51 | 480p $0.08 · 720p $0.18 · 1080p $0.45 |
| **Seedance 2.5** | 480p $0.14 · 720p $0.315 · 1080p $0.79 | 480p $0.10 · 720p $0.23 |
| **Kling 2.6 motion control** | 720p $0.055 · 1080p $0.09 | 720p $0.07 · 1080p $0.12 |
| **Kling 3.0 motion control** | 720p $0.10 · 1080p $0.135 | 720p $0.07 · 1080p $0.12 |

Seedance with a reference clip is billed by its own rate - the video chat says it before the press.

**Talking head clips**: **kling avatar** 720p $0.04 · 1080p $0.08 a second of the read (whole seconds, rounded down);
**omnihuman 2.0** 720p $0.07 a second (a read under 4 s billed as 4 s). Its frames are pictures (above).

## Voice, music and sounds

| What | Price |
|---|---|
| Reading (talking head, voiceover) | ElevenLabs characters of your plan - about one a letter; the balance is on Home → The app |
| Suno - **Simple**, **Custom** | 12 kie.ai credits, $0.06 - two tracks |
| Suno - **Lyrics** | $0.002 - two or three texts |
| Suno - **Sounds** | $0.0125 |
| ElevenLabs - **From a description**, **Video to Music** | about $0.15 a minute of music (a paid ElevenLabs plan) |
| ElevenLabs - **Sound effects** | 40 ElevenLabs credits a second |

A kie.ai credit is $0.005.

## Words: hearing and the agents

- **Hearing** - Groq $0.111 an hour of sound; whisper on this computer, nothing. A sound heard once is never paid for
  again.
- **The agents** - the writers of prompts, the B-roll's queries, the moments of highlights, the Assistant - are paid by
  their words. Gemini Flash on kie.ai or Replicate: a fraction of a cent a call. Claude, per million tokens (about 750 000 words) in / out:
  **Opus 5.5** $4 / $20, **Sonnet 5.5** $2 / $10, **Haiku 5.5** $0.10 / $0.50.
- **Highlights** - the window says the price before **Find moments**: the hearing (by Groq, $0.11 an hour of video)
  plus the agent's words - more for a longer video and a larger count.

## Free

Everything done on this computer: editing, cutting, cut silence, captions drawn, effects, patterns, framing by faces,
rendering, whisper. Pixabay's footage and photos, Freesound's sounds, the built-in sound effects and patterns.
