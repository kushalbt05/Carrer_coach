# Elevate Career Application Architecture

```mermaid
flowchart TD
    Person[User in browser]
    Web[Next.js App Router<br/>React pages and UI components]
    AuthUI[Clerk sign in and sign up]
    Guard[Clerk middleware<br/>protects dashboard, resume,<br/>interview, cover-letter, onboarding]
    Form[Onboarding form]
    ResumeUI[Resume builder]
    QuizUI[Mock interview quiz]
    LetterUI[Cover letter generator]
    DashboardUI[Dashboard and industry insights]

    Actions[Next.js server actions<br/>user, dashboard, resume,<br/>interview, cover letter]
    Clerk[Clerk authentication<br/>user identity]
    Prisma[Prisma Client]
    DB[(Neon PostgreSQL<br/>User, IndustryInsight,<br/>Resume, Assessment, CoverLetter)]
    Gemini[Google Gemini API<br/>industry insights, quiz questions,<br/>resume and cover-letter assistance]
    Inngest[Inngest event and cron runtime]
    InsightsJob[Weekly industry-insights job]

    Person --> Web
    Web --> Guard
    Guard -->|signed out| AuthUI
    Guard -->|signed in| Web
    Web --> Form
    Web --> ResumeUI
    Web --> QuizUI
    Web --> LetterUI
    Web --> DashboardUI

    Form -->|save profile| Actions
    ResumeUI -->|load/save resume| Actions
    QuizUI -->|generate quiz / save score| Actions
    LetterUI -->|generate / list / delete| Actions
    DashboardUI -->|read insights| Actions

    Actions -->|verify session| Clerk
    Actions --> Prisma
    Prisma --> DB
    Actions -->|generate content| Gemini

    Inngest -->|serves /api/inngest| InsightsJob
    InsightsJob -->|read and update industry data| Prisma
    InsightsJob -->|generate weekly insights| Gemini

    DB -.->|profile, resume, quiz results,<br/>cover letters and insights| Actions
```

## Main request flows

- **Authentication:** Clerk provides sign-in and sign-up. Middleware protects the app's career features and redirects signed-out visitors to sign-in.
- **Onboarding:** The form submits profile details to a server action, which verifies the Clerk session and saves the profile through Prisma to Neon.
- **Career tools:** Resume, interview, and cover-letter pages call server actions. Those actions use Prisma for stored records and Gemini for generated content where needed.
- **Dashboard:** The dashboard reads the signed-in user's industry insights from Neon. If insights are missing, the dashboard action generates them with Gemini and stores them through Prisma.
- **Scheduled insights:** Inngest serves the `/api/inngest` route and runs the weekly industry-insights function, which reads and updates Neon data and calls Gemini.

## Technology summary

| Layer | Technology | Responsibility |
| --- | --- | --- |
| UI and routing | Next.js App Router, React | Pages, layouts, forms, and interactive career tools |
| Authentication | Clerk | User identity, sign-in, sign-up, and protected routes |
| Application logic | Next.js server actions | Authenticated reads, writes, and AI requests |
| ORM and persistence | Prisma, Neon PostgreSQL | Data access and durable application records |
| Generative AI | Google Gemini API | Industry insights, mock questions, resume and cover-letter content |
| Scheduled work | Inngest | Weekly industry-insight refresh |
