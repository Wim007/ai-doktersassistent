/**
 * Ambient AI Doktersassistent — Back-end
 * Node.js + Express
 *
 * Endpoints:
 *   POST /api/transcribe  → ontvangt audio (FormData), retourneert transcript
 *   POST /api/consult     → ontvangt transcript + patiëntcontext, retourneert drie AI-tekstblokken
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
// Prompt: Hoofdconsult — alleen SOEP-verslag + patiëntuitleg (2 blokken)
// ─────────────────────────────────────────────────────────────────────────────
function buildMainPrompt() {
  return `Je bent een AI-doktersassistent in een Nederlandse huisartsenpraktijk. Je ontvangt de volledige transcriptie van een consult (arts én patiënt). Geef ALTIJD en UITSLUITEND de volgende twee blokken terug, in exact dit formaat:

1) MEDISCH VERSLAG (VOOR DOSSIER)
[Schrijf een kort SOEP-verslag (Subjectief, Objectief, Evaluatie, Plan). Maximaal 8 zinnen. Professionele medische taal. Alleen gebaseerd op de transcriptie.]

2) UITLEG VOOR DE PATIËNT (EENVOUDIG NEDERLANDS)
[Leg de bevindingen en het plan uit in eenvoudig Nederlands. Maximaal 250 woorden. Gebruik u-vorm. Geen medisch jargon. Leg uit wat er aan de hand is, wat er gaat gebeuren, en wanneer de patiënt opnieuw contact moet opnemen.]

Gebruik NOOIT andere secties of koppen. Schrijf de nummers en titels exact zoals hierboven.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt: Gender-bias aandachtspunten (alleen bij vrouwen met risicoklachten)
// ─────────────────────────────────────────────────────────────────────────────
function buildGenderBiasPrompt() {
  return `Je bent een klinisch beslisondersteunende AI voor huisartsen in Nederland.
Je genereert alleen 'Aandachtspunten voor de arts' om GENDERBIAIS bij VROUWELIJKE patiënten te signaleren en te beperken.
BELANGRIJK:
- Geef GEEN algemene suggesties of tips.
- Geef géén aandachtspunten bij klachten waarbij geen bekende genderbias speelt (bijvoorbeeld een simpele traumatische breuk van een vinger).
- In dat geval moet je precies antwoorden met:
  "Geen gender-specifieke aandachtspunten."
De input bevat:
- geslacht (vrouw),
- leeftijd,
- huidige klacht/episode + ICPC-code,
- korte SOEP-samenvatting van dit consult,
- een korte samenvatting van eerdere consulten voor dezelfde klacht (aantal, eerdere werkdiagnoses, behandelingen, effect),
- relevante voorgeschiedenis en medicatie.
Gebruik je kennis over genderongelijkheid in de zorg:
- Bij vrouwen worden o.a. atypische hartklachten, auto-immuunziekten, hormonale oorzaken, endometriose en chronische pijn/hoofdpijn vaker gemist of te snel als psychisch/stress verklaard.
- Vrouwen komen vaker herhaald terug met dezelfde klachten zonder duidelijke diagnose of effectief beleid.
GENEREER ALLEEN AANDACHTSPUNTEN ALS:
- het gaat om een vrouwelijke patiënt EN
- de klacht valt in één van de genoemde risicogroepen.
Taak wanneer bovenstaande waar is:
- Geef maximaal 3 genummerde 'Aandachtspunten voor de arts' met:
  1. Mogelijke ernstige of vaak gemiste diagnose bij vrouwen die op basis van de tekst extra moet worden overwogen of uitgesloten.
  2. Eén expliciet gender-gerelateerd risico, zoals te snelle psychische duiding, onderschatting van atypische hartklachten of het missen van hormonale/gynaecologische/auto-immuun oorzaken.
  3. Een voorstel voor herbezinning als er meerdere consulten zonder duidelijk resultaat zijn geweest (heroverweeg diagnose, aanvullend onderzoek of verwijzing).
Regels:
- Maximaal 2 zinnen per punt, professioneel Nederlands, gericht aan de huisarts.
- Stel nooit een definitieve diagnose; gebruik "overweeg", "sluit uit", "denk aan", "heroverweeg".
- Voeg geen feiten toe die niet logisch uit de input zijn af te leiden.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bepaal of gender-bias check nodig is
// Voorwaarden: geslacht == V (vrouw) én klacht valt in risicocategorie
// ─────────────────────────────────────────────────────────────────────────────
const GENDER_BIAS_PATTERNS = [
  /hoofdpijn/i,
  /chronische pijn/i,
  /pijn op de borst/i,
  /benauwdheid/i,
  /hartklacht/i,
  /vermoeid/i,
  /vage klacht/i,
  /buikpijn/i,
  /buik/i,
  /bekkenpijn/i,
  /menstruatie/i,
  /menstrueel/i,
  /herhaald/i,
  /terugkeren/i,
  /moeheid/i,
];

function shouldCheckGenderBias(gender, complaint) {
  if (!gender || gender.toUpperCase() !== "V") return false;
  if (!complaint) return false;
  return GENDER_BIAS_PATTERNS.some((re) => re.test(complaint));
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser: verdeelt de LLM-output in twee losse velden
// ─────────────────────────────────────────────────────────────────────────────
function parseConsultOutput(text) {
  const sections = { medical_note: "", patient_explanation: "" };
  const block1 = text.match(/1\)\s*MEDISCH VERSLAG.*?\n([\s\S]*?)(?=2\)\s*UITLEG|$)/i);
  const block2 = text.match(/2\)\s*UITLEG.*?\n([\s\S]*)$/i);
  if (block1) sections.medical_note = block1[1].trim();
  if (block2) sections.patient_explanation = block2[1].trim();
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
// Body: { transcript, gender?, complaint?, age?, history?, medication? }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/consult", async (req, res) => {
  const { transcript, gender, complaint, age, history, medication } = req.body;

  if (!transcript || transcript.trim().length === 0) {
    return res.status(400).json({ error: "Geen transcriptie ontvangen." });
  }

  try {
    // ── Stap 1: Hoofdcall — SOEP-verslag + patiëntuitleg ──────────────────
    const mainResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: buildMainPrompt() },
        { role: "user", content: `TRANSCRIPTIE VAN HET CONSULT:\n\n${transcript}` },
      ],
    });

    const rawText = mainResponse.choices[0]?.message?.content ?? "";
    if (!rawText) {
      return res.status(500).json({ error: "Geen output van het model ontvangen." });
    }

    const parsed = parseConsultOutput(rawText);

    // ── Stap 2: Gender-bias call (alleen indien van toepassing) ───────────
    let clinician_alerts = null;

    if (shouldCheckGenderBias(gender, complaint)) {
      const contextLines = [
        "Geslacht: vrouw",
        age ? `Leeftijd: ${age} jaar` : null,
        complaint ? `Huidige klacht: ${complaint}` : null,
        `SOEP-samenvatting van dit consult:\n${parsed.medical_note}`,
        Array.isArray(history) && history.length
          ? `Voorgeschiedenis: ${history.join(", ")}`
          : null,
        medication ? `Medicatie: ${medication}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const biasResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: buildGenderBiasPrompt() },
          { role: "user", content: contextLines },
        ],
      });

      clinician_alerts = biasResponse.choices[0]?.message?.content?.trim() ?? null;
    }

    return res.json({
      medical_note: parsed.medical_note,
      patient_explanation: parsed.patient_explanation,
      clinician_alerts,
    });
  } catch (err) {
    console.error("[/api/consult]", err);
    return res.status(500).json({ error: "AI-verwerking mislukt: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo pagina
// ─────────────────────────────────────────────────────────────────────────────
app.get("/demo", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "demo.html"));
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
