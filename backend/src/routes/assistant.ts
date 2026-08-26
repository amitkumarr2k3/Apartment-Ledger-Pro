// src/routes/assistant.ts
import { FastifyInstance } from "fastify";
import { z } from "zod";
import manualSections from "../data/manual-sections";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const AskBody = z.object({
  question: z.string().min(1),
  currentView: z.string().optional(),
});

function buildContext(currentView?: string): string {
  const pageText = currentView ? manualSections.pages[currentView] : undefined;
  return [
    manualSections.shared.howToRead,
    pageText
      ? `--- Manual section for the page the user is currently viewing (${currentView}) ---\n${pageText}`
      : "--- The user's current page isn't recognised; answer generally if possible. ---",
    "--- Common Questions (FAQ) ---",
    manualSections.shared.faq,
  ].filter(Boolean).join("\n\n");
}

function buildPrompt(question: string, currentView: string | undefined, context: string): string {
  return `You are Munshi, a helpful assistant embedded inside PulseLedger, a housing society finance dashboard for CG Boulevard. Answer the resident or admin's question using ONLY the manual excerpts provided below -- never invent a number, feature, or badge that isn't mentioned in them. Be concise (2-4 sentences, no preamble). If the excerpts genuinely don't cover the question, say so honestly and suggest they check with an admin or read the full user guide, rather than guessing.

MANUAL EXCERPTS:
${context}

USER'S CURRENT PAGE: ${currentView ?? "unknown"}
USER'S QUESTION: ${question}`;
}

export async function routes(app: FastifyInstance) {
  // Registered with prefix "/api/assistant" in server.ts -- final path is
  // POST /api/assistant/ask. Auth follows the exact same pattern as every
  // other protected route (see routes/me.ts): app.auth as the preHandler,
  // req.user for whoever's asking. Any signed-in resident/admin can use it --
  // no role check needed, since Munshi only ever answers from the public
  // user manual, never from live financial data.
  app.post("/ask", { preHandler: app.auth }, async (req) => {
    const body = AskBody.parse(req.body);
    const question = body.question.trim();
    const currentView = body.currentView;

    if (!GEMINI_API_KEY) {
      app.log.warn("GEMINI_API_KEY not set -- assistant is unconfigured");
      return { answer: "Munshi isn't fully set up yet -- ask your admin to configure the AI assistant." };
    }

    const context = buildContext(currentView);
    const prompt = buildPrompt(question, currentView, context);

    try {
      const r = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // maxOutputTokens raised from 300 -- newer Gemini models can spend
          // part of that budget on internal "thinking" before writing the
          // visible answer, so a low limit was cutting replies off mid-
          // sentence rather than ever actually running out of things to say.
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      });

      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        app.log.error({ status: r.status, body: errBody }, "gemini request failed");
        return { answer: "Sorry, I'm having trouble answering right now -- please try again in a moment." };
      }

      const data: any = await r.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return { answer: (text && text.trim()) || "Sorry, I couldn't come up with an answer for that." };
    } catch (err) {
      app.log.error(err, "gemini call threw");
      return { answer: "Sorry, I'm having trouble reaching the assistant right now -- please try again in a moment." };
    }
  });
}
