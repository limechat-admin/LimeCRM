import { mantineHtmlProps } from "@mantine/core";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import { AppFrame } from "@/components/app-frame";
import { resolveViewer } from "@/server/auth";
import { COLOR_SCHEME_COOKIE, parseColorScheme } from "@/theme/color-scheme";
import { ThemeProvider } from "@/theme/provider";
import "./globals.css";

const lato = localFont({
  src: [
    { path: "../theme/fonts/lato-normal.woff2", weight: "400", style: "normal" },
    { path: "../theme/fonts/lato-normal-italic.woff2", weight: "400", style: "italic" },
    { path: "../theme/fonts/lato-semibold.woff2", weight: "600", style: "normal" },
    { path: "../theme/fonts/lato-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});

// Every page reads live CRM data.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "LimeCRM", template: "%s · LimeCRM" },
  description: "LimeChat's CRM: deals, onboarding and the customer book in one place.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Signed-out screens (/signin, /signout) render without the app frame; pages enforce sign-in themselves.
  const { user } = await resolveViewer();
  // Email preference pages are for customers: light, no app frame, even for a signed-in visitor.
  const publicPage = (await headers()).get("x-lc-public") === "1";
  const colorScheme = publicPage ? "light" : parseColorScheme((await cookies()).get(COLOR_SCHEME_COOKIE)?.value);
  return (
    <html lang="en" {...mantineHtmlProps} data-mantine-color-scheme={colorScheme} className={lato.variable}>
      <body>
        <ThemeProvider colorScheme={colorScheme}>
          {user && !publicPage ? <AppFrame user={{ name: user.name, email: user.email, role: user.role }}>{children}</AppFrame> : children}
        </ThemeProvider>
      </body>
    </html>
  );
}
