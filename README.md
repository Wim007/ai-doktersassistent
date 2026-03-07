# Ambient AI Doktersassistent — MVP

## Architectuur

```
Browser (Vanilla HTML/JS)
  │  POST /api/transcribe  (FormData met AudioBlob)
  │  POST /api/consult     (JSON met transcript)
  ▼
Node.js + Express (back-end)
  │  transcribeAudio()     ← placeholder, koppel hier je STT-service
  │  OpenAI Responses API  ← gpt-4o, strikte SOEP-prompt
  ▼
OpenAI API
```

### Waarom deze keuzes?

| Onderdeel | Keuze | Reden |
|---|---|---|
| Front-end | Vanilla HTML + JS | Geen build-tooling nodig voor MVP; draait direct in de browser |
| Back-end | Node.js + Express | Minimaal, bekend, eenvoudig uit te breiden |
| Audio-opname | MediaRecorder API | Native browser-API, geen extra library |
| STT | Placeholder (`transcribeAudio`) | Eenvoudig te vervangen door Whisper, Azure of Google |
| LLM | OpenAI Responses API (gpt-4o) | Nieuwste API-stijl, hoge kwaliteit medische output |
| State | In-memory | Geen database nodig voor demo |

---

## Installatie & opstarten

### 1. Back-end

```bash
cd backend
cp .env.example .env
# Vul OPENAI_API_KEY in .env

npm install
npm run dev        # of: npm start
```

Server draait op `http://localhost:3001`

### 2. Front-end

Open `frontend/index.html` direct in de browser.
> Let op: Chrome/Edge blokkeren microfoon op `file://`. Gebruik een simpele lokale server:
```bash
cd frontend
npx serve .        # of: python3 -m http.server 8080
```

---

## API-referentie

### `POST /api/transcribe`

**Request** — `multipart/form-data`
```
audio: <AudioBlob>   (webm, ogg of mp4)
```

**Response**
```json
{ "transcript": "Arts: Goedemiddag mevrouw…\nPatiënt: Ik heb last van…" }
```

---

### `POST /api/consult`

**Request**
```json
{
  "transcript": "Arts: Goedemiddag mevrouw De Vries, wat brengt u vandaag bij ons?\nPatiënt: Ik heb al weken last van extreme vermoeidheid en haaruitval…"
}
```

**Response**
```json
{
  "medical_note": "S: Patiënte, 42 jaar, presenteert zich met drie maanden durende vermoeidheid, koude-intolerantie, haaruitval en een gewichtstoename van enkele kilogrammen zonder dieetverandering. Tevens stemmingsdaling gemeld door partner.\nO: Niet objectief onderzocht in deze transcriptie.\nE: Klinisch beeld passend bij hypothyreoïdie; differentiaaldiagnose omvat anemie of depressie.\nP: TSH, vrij T4, volledig bloedbeeld afnemen; revisie na uitslag.",

  "patient_explanation": "Geachte mevrouw De Vries, de dokter vermoedt dat uw klachten mogelijk worden veroorzaakt door een schildklier die minder goed werkt dan normaal. De schildklier is een klein orgaan in uw hals dat hormonen aanmaakt die uw stofwisseling regelen. Als de schildklier te weinig hormonen produceert, kunt u zich moe, koud en somber voelen en kunt u aankomen. Om dit te bevestigen wordt er bloed afgenomen. U hoort de uitslag zodra die bekend is. Neem eerder contact op als de klachten erger worden, u kortademig wordt, of als u zich ernstig zorgen maakt.",

  "clinician_alerts": "- Overweeg hypothyreoïdie als primaire diagnose: het klachtenpatroon (vermoeidheid, koude-intolerantie, haaruitval, gewichtstoename, stemmingsdaling) is sterk suggestief; vraag TSH en vrij T4 aan.\n- Denk ook aan perimenopauze als mede-oorzaak: patiënte is 42 jaar en hormonale schommelingen kunnen het beeld versterken of imiteren; overweeg een AMH-bepaling of gynaecologisch consult.\n- Bij twijfel of geen afwijkende schildklierwaarden: sluit anemie (ferritine, B12) en depressie uit, en overweeg of cyclusgebonden klachtenpatroon aanwezig is."
}
```

---

## STT-service koppelen

Vervang in `backend/server.js` de functie `transcribeAudio(audioBuffer)`:

```js
// Voorbeeld met OpenAI Whisper:
import fs from "fs";
import path from "path";
import os from "os";

async function transcribeAudio(audioBuffer) {
  const tmpPath = path.join(os.tmpdir(), `opname-${Date.now()}.webm`);
  fs.writeFileSync(tmpPath, audioBuffer);

  const transcription = await openai.audio.transcriptions.create({
    file:  fs.createReadStream(tmpPath),
    model: "whisper-1",
    language: "nl",
  });

  fs.unlinkSync(tmpPath);
  return transcription.text;
}
```

---

## Privacy & compliance

- **Geen data wordt opgeslagen.** Audio en transcripties leven uitsluitend in memory.
- Voor productiegebruik: versleuteld transport (HTTPS), verwerkersovereenkomst met OpenAI, AVG-compliance.
- De disclaimer op het scherm maakt duidelijk dat de arts eindverantwoordelijk blijft.
