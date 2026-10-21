"use client";
/** Mantine with the LimeChat theme, exact colour tokens and toasts. */
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { useState, type ReactNode } from "react";
import { cookieColorSchemeManager } from "./color-scheme";
import { limechatCssVariables, limechatTheme } from "./theme";

export function ThemeProvider({ colorScheme, children }: { colorScheme: "light" | "dark"; children: ReactNode }) {
  const [manager] = useState(cookieColorSchemeManager);
  return (
    <MantineProvider
      theme={limechatTheme}
      cssVariablesResolver={limechatCssVariables}
      colorSchemeManager={manager}
      defaultColorScheme={colorScheme}
    >
      <Notifications position="bottom-right" />
      {children}
    </MantineProvider>
  );
}
