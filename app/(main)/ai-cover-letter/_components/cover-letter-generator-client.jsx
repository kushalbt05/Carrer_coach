"use client";

import dynamic from "next/dynamic";

const CoverLetterGenerator = dynamic(() => import("./cover-letter-generator"), {
  ssr: false,
  loading: () => <div className="min-h-48" aria-busy="true" />,
});

export default function CoverLetterGeneratorClient() {
  return <CoverLetterGenerator />;
}
