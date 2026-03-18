/**
 * Ambient AI Doktersassistent — Back-end
 * Node.js + Express
 *
 * Endpoints:
 *   POST /api/transcribe  → ontvangt audio (FormData), retourneert transcript
 *   POST /api/consult     → ontvangt transcript, retourneert drie AI-tekstblokken
 *   GET  /                → serveert de frontend (public/index.html)
 */
import express from "express";
import multer from "multer";
import cors from "cors";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serveer de frontend statisch vanuit de public/ map
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI client
// ─────────────────────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─────────────────────────────────────────────────────────────────────────────
// Whisper transcriptie via OpenAI API
// ─────────────────────────────────────────────────────────────────────────────
async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  console.log(`[transcribeAudio] Ontvangen buffer: ${audioBuffer.length} bytes`);
  const file = await toFile(audioBuffer, "opname.webm", { type: mimeType });
  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "nl",
  });
  return response.text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-template voor de OpenAI Responses API
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  return `Je bent een AI-doktersassistent in een Nederlandse huisartsenpraktijk. Je ontvangt de volledige transcriptie van een consult (arts én patiënt). Geef ALTIJD en UITSLUITEND de volgende drie blokken terug, in exact dit formaat:

1) MEDISCH VERSLAG (VOOR DOSSIER)
[Schrijf een kort SOEP-verslag (Subjectief, Objectief, Evaluatie, Plan). Maximaal 8 zinnen. Professionele medische taal. Alleen gebaseerd op de transcriptie.]

2) UITLEG VOOR DE PATIËNT (EENVOUDIG NEDERLANDS)
[Leg de bevindingen en het plan uit in eenvoudig Nederlands. Maximaal 250 woorden. Gebruik u-vorm. Geen medisch jargon. Leg uit wat er aan de hand is, wat er gaat gebeuren, en wanneer de patiënt opnieuw contact moet opnemen.]

3) AANDACHTSPUNTEN VOOR DE ARTS
- [bullet 1]
- [bullet 2]
- [bullet 3]

Bij blok 3: focus expliciet op blinde vlekken en onderherkende aandoeningen bij vrouwen, waaronder endometriose, hormonale stoornissen (schildklier, PCOS, perimenopauze), atypische cardiovasculaire presentaties, auto-immuunziekten en cyclusgebonden klachtverergering. Formuleer ALTIJD als suggesties met woorden als "overweeg", "denk ook aan" of "bij twijfel". Gebruik NOOIT andere secties of koppen. Schrijf de nummers en titels exact zoals hierboven.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser: verdeelt de LLM-output in drie losse velden
// ─────────────────────────────────────────────────────────────────────────────
function parseConsultOutput(text) {
  const sections = {
    medical_note: "",
    patient_explanation: "",
    clinician_alerts: "",
  };
  const block1 = text.match(/1\)\s*MEDISCH VERSLAG.*?\n([\s\S]*?)(?=2\)\s*UITLEG|$)/i);
  const block2 = text.match(/2\)\s*UITLEG.*?\n([\s\S]*?)(?=3\)\s*AANDACHTSPUNTEN|$)/i);
  const block3 = text.match(/3\)\s*AANDACHTSPUNTEN.*?\n([\s\S]*)$/i);
  if (block1) sections.medical_note = block1[1].trim();
  if (block2) sections.patient_explanation = block2[1].trim();
  if (block3) sections.clinician_alerts = block3[1].trim();
  return sections;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transcribe
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const audioBuffer = req.file?.buffer;
    if (!audioBuffer) {
      return res.status(400).json({ error: "Geen audiobestand ontvangen." });
    }
    const transcript = await transcribeAudio(audioBuffer, req.file.mimetype);
    return res.json({ transcript });
  } catch (err) {
    console.error("[/api/transcribe]", err);
    return res.status(500).json({ error: "Transcriptie mislukt." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/consult
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/consult", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || transcript.trim().length === 0) {
    return res.status(400).json({ error: "Geen transcriptie ontvangen." });
  }
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions: buildSystemPrompt(),
      input: `TRANSCRIPTIE VAN HET CONSULT:\n\n${transcript}`,
    });
    const rawText =
      response.output_text ??
      response.output
        ?.find((b) => b.type === "message")
        ?.content
        ?.filter((c) => c.type === "output_text")
        ?.map((c) => c.text)
        ?.join("") ??
      "";
    if (!rawText) {
      return res.status(500).json({ error: "Geen output van het model ontvangen." });
    }
    const parsed = parseConsultOutput(rawText);
    return res.json(parsed);
  } catch (err) {
    console.error("[/api/consult]", err);
    return res.status(500).json({ error: "AI-verwerking mislukt: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Catch-all: stuur altijd index.html terug voor niet-API routes
// ─────────────────────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server draait op http://localhost:${PORT}`));
