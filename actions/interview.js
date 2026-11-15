"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use the lighter model first for faster quiz startup; retry on Gemini 3.8 if
// the lightweight endpoint is temporarily at capacity.
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

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

    if (
      !Array.isArray(quiz.questions) ||
      quiz.questions.length !== questionCount ||
      quiz.questions.some(
        (question) =>
          typeof question.question !== "string" ||
          !Array.isArray(question.options) ||
          question.options.length !== 4 ||
          !question.options.includes(question.correctAnswer) ||
          typeof question.explanation !== "string"
      )
    ) {
      throw new Error("Gemini returned questions in an unexpected format.");
    }

    return quiz.questions;
  } catch (error) {
    console.error("Error generating quiz:", error);
    throw new Error(`Failed to generate quiz questions: ${error.message}`);
  }
}

export async function saveQuizResult(questions, answers, score) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  const questionResults = questions.map((q, index) => ({
    question: q.question,
    answer: q.correctAnswer,
    userAnswer: answers[index],
    isCorrect: q.correctAnswer === answers[index],
    explanation: q.explanation,
  }));

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
      console.log(improvementTip);
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
