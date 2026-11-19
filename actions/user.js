"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const updateUserSchema = z.object({
  industry: z.string().trim().min(1).max(120),
  experience: z.coerce.number().int().min(0).max(50),
  bio: z.string().trim().max(500).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

export async function updateUser(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const parsedData = updateUserSchema.safeParse(data);
  if (!parsedData.success) throw new Error("Please provide a valid career profile.");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    // Save the profile without waiting for the Gemini request. The dashboard
    // generates industry insights when it first needs them.
    await db.user.update({
      where: { id: user.id },
      data: {
        industry: parsedData.data.industry,
        experience: parsedData.data.experience,
        bio: parsedData.data.bio,
        skills: parsedData.data.skills,
      },
    });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Error updating user and industry:", error.message);
    throw new Error("Failed to update profile");
  }
}

export async function getUserOnboardingStatus() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId,
      },
      select: {
        industry: true,
      },
    });

    return {
      isOnboarded: !!user?.industry,
    };
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    throw new Error("Failed to check onboarding status");
  }
}
