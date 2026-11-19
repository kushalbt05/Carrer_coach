"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use the lighter model first for faster quiz startup; retry on Gemini 3.8 if
// the lightweight endpoint is temporarily at capacity.
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
const quizQuestionSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).length(4),
  correctAnswer: z.string().trim().min(1).max(300),
  explanation: z.string().trim().max(1000),
}).refine((question) => question.options.includes(question.correctAnswer));
const signedQuizSchema = z.object({
  userId: z.string().min(1),
  issuedAt: z.number().int().positive(),
  questions: z.array(quizQuestionSchema).length(5),
});

function signQuizPayload(payload) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("Quiz signing is not configured.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export async function generateQuiz() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      industry: true,
      skills: true,
    },
  });

  if (!user) throw new Error("User not found");
  if (!user.industry) throw new Error("Please complete your profile first by selecting an industry in onboarding");

  const questionCount = 5;
  const prompt = `Create exactly ${questionCount} concise multiple-choice technical interview questions for a professional in ${user.industry}${user.skills?.length ? `, focusing on ${user.skills.join(", ")}` : ""}. Each question must have exactly 4 short options, a correctAnswer identical to one option, and an explanation of at most one sentence. Return only this JSON shape: {"questions":[{"question":"...","options":["...","...","...","..."],"correctAnswer":"...","explanation":"..."}]}`;

  try {
    const request = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 1600,
      },
    };

    let result;
    try {
      result = await model.generateContent(request);
    } catch (error) {
      const isCapacityError =
        error.status === 503 || /\b503\b|high demand|service unavailable/i.test(error.message);
      if (!isCapacityError) throw error;

      // Retry temporary Gemini capacity spikes on a lighter model.
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });
      result = await fallbackModel.generateContent(request);
    }

    const response = result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();
    const quiz = JSON.parse(cleanedText);

    const parsedQuestions = z.array(quizQuestionSchema).length(questionCount).safeParse(quiz.questions);
    if (!parsedQuestions.success) {
      throw new Error("Gemini returned questions in an unexpected format.");
    }

    const payload = Buffer.from(JSON.stringify({
      userId,
      issuedAt: Date.now(),
      questions: parsedQuestions.data,
    })).toString("base64url");

    return {
      questions: parsedQuestions.data,
      token: `${payload}.${signQuizPayload(payload)}`,
    };
  } catch (error) {
    console.error("Error generating quiz:", error);
    throw new Error(`Failed to generate quiz questions: ${error.message}`);
  }
}

export async function saveQuizResult(token, answers) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  if (typeof token !== "string" || token.length > 20000) {
    throw new Error("Invalid quiz submission.");
  }

  const [payload, signature, ...extraParts] = token.split(".");
  if (!payload || !signature || extraParts.length) {
    throw new Error("Invalid quiz submission.");
  }

  const expectedSignature = Buffer.from(signQuizPayload(payload), "base64url");
  const submittedSignature = Buffer.from(signature, "base64url");
  if (
    expectedSignature.length !== submittedSignature.length ||
    !timingSafeEqual(expectedSignature, submittedSignature)
  ) {
    throw new Error("Invalid quiz submission.");
  }

  let decodedPayload;
  try {
    decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid quiz submission.");
  }

  const parsedQuiz = signedQuizSchema.safeParse(decodedPayload);
  if (!parsedQuiz.success || parsedQuiz.data.userId !== userId) {
    throw new Error("Invalid quiz submission.");
  }
  if (Date.now() - parsedQuiz.data.issuedAt > 30 * 60 * 1000 || parsedQuiz.data.issuedAt > Date.now() + 60_000) {
    throw new Error("This quiz has expired. Please start a new quiz.");
  }

  const parsedAnswers = z.array(z.string().trim().min(1).max(300)).length(parsedQuiz.data.questions.length).safeParse(answers);
  if (
    !parsedAnswers.success ||
    parsedAnswers.data.some((answer, index) => !parsedQuiz.data.questions[index].options.includes(answer))
  ) {
    throw new Error("Please answer every question using one of the provided options.");
  }

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  const questionResults = parsedQuiz.data.questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: parsedAnswers.data[index],
    isCorrect: q.correctAnswer === parsedAnswers.data[index],
    explanation: q.explanation,
  }));
  const score = (questionResults.filter((question) => question.isCorrect).length / questionResults.length) * 100;

  // Get wrong answers
  const wrongAnswers = questionResults.filter((q) => !q.isCorrect);

  // Only generate improvement tips if there are wrong answers
  let improvementTip = null;
  if (wrongAnswers.length > 0) {
    const wrongQuestionsText = wrongAnswers
      .map(
        (q) =>
          `Question: "${q.question}"\nCorrect Answer: "${q.answer}"\nUser Answer: "${q.userAnswer}"`
      )
      .join("\n\n");

    const improvementPrompt = `
      The user got the following ${user.industry} technical interview questions wrong:

      ${wrongQuestionsText}

      Based on these mistakes, provide a concise, specific improvement tip.
      Focus on the knowledge gaps revealed by these wrong answers.
      Keep the response under 2 sentences and make it encouraging.
      Don't explicitly mention the mistakes, instead focus on what to learn/practice.
    `;

    try {
      const tipResult = await model.generateContent(improvementPrompt);

      improvementTip = tipResult.response.text().trim();
    } catch (error) {
      console.error("Error generating improvement tip:", error);
      // Continue without improvement tip if generation fails
    }
  }

  try {
    const assessment = await db.assessment.create({
      data: {
        userId: user.id,
        quizScore: score,
        questions: questionResults,
        category: "Technical",
        improvementTip,
      },
    });

    return assessment;
  } catch (error) {
    console.error("Error saving quiz result:", error);
    throw new Error("Failed to save quiz result");
  }
}

export async function getAssessments() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const assessments = await db.assessment.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return assessments;
  } catch (error) {
    console.error("Error fetching assessments:", error);
    throw new Error("Failed to fetch assessments");
  }
}
