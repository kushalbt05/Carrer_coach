"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const HeroSection = () => {

  return (
    <section className="w-full pt-36 md:pt-48 pb-10">
      <div className="space-y-6 text-center">
        <div className="space-y-6 mx-auto">
          <h1 className="text-5xl font-bold md:text-6xl lg:text-7xl xl:text-8xl gradient-title animate-gradient">
            Elevate Your Career
            <br />
            with AI-Powered Growth
          </h1>
          <p className="mx-auto max-w-[600px] text-muted-foreground md:text-xl">
            Transform your professional journey with personalized guidance, interview prep, and
            intelligent tools designed to elevate your career to new heights.
          </p>
        </div>
        <div className="flex justify-center space-x-4">
          <Link href="/dashboard">
            <Button size="lg" className="px-8">
              Get Started
            </Button>
          </Link>
          <Link href="https://en.wikipedia.org/wiki/AI_boom">
            <Button size="lg" variant="outline" className="px-8">
              Know more
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
