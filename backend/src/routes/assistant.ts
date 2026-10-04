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

const directQuantityRequest = /\bhow (?:much|many)\b/i;
const commandedFigureRequest = /\b(?:show|tell|give|provide|fetch|read|calculate|display)\s+(?:me\s+)?(?:the\s+)?(?:(?:current|latest|exact|total)\s+)?(?:amount|numeric value|value|figure|figures|number|total|balance|percentage|percent|rate|income|expenses?|collections?|receivables?|surplus|reserves?|corpus|maintenance)\b/i;
const currentFigureRequest = /\bwhat(?:'s| is)\s+(?:the\s+)?(?:current|latest|exact|total)\s+(?:income|expenses?|collections?|receivables?|surplus|reserves?|corpus|maintenance|balance|net position)\b|\bwhat(?:'s| is)\s+(?:the\s+)?(?:amount|numeric value|value|figure|figures|number|balance|percentage|percent|rate)\b/i;
const currencyAmount = /(?:₹|\brs\.?\s*\d|\binr\s*\d|\d[\d,]*(?:\.\d+)?\s*(?:rupees|inr)\b)/i;

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

export function asksForDashboardFigure(question: string): boolean {
  return directQuantityRequest.test(question)
    || commandedFigureRequest.test(question)
    || currentFigureRequest.test(question)
    || currencyAmount.test(question);
}

function buildPrompt(question: string, currentView: string | undefined, context: string): string {
  return `You are Munshi, a helpful assistant embedded inside PulseLedger, a housing society finance dashboard for CG Boulevard. Answer using ONLY the manual excerpts below. You do not receive live dashboard figures: never claim to have read, retrieved, or calculated them. If the user asks for an actual dashboard amount, count, percentage, balance, or other figure, politely decline and offer to explain the metric or point them to where it appears in the dashboard. For conceptual questions, explain the idea plainly and directly using the excerpts. Never invent numbers, features, or badges. Be concise (2-4 sentences, answer directly without a preamble). If the excerpts do not cover a concept, say so and suggest checking with an admin or the full user guide rather than guessing.

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

    if (asksForDashboardFigure(question)) {
      return {
        answer: "Sorry, I can't provide, retrieve, or calculate dashboard figures. They stay in the dashboard and are not sent to Munshi's AI service. I can explain what a metric means or help you find it on the dashboard.",
      };
    }

    if (!GEMINI_API_KEY) {
      app.log.warn("GEMINI_API_KEY not set -- assistant is unconfigured");
      return { answer: "Munshi isn't fully set up yet -- ask your admin to configure the AI assistant." };
    }

    const context = buildContext(currentView);
    const prompt = buildPrompt(question, currentView, context);

    try {
      const r = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
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
