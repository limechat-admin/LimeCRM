"use client";
/** Last-resort error page when the root layout itself fails. It replaces <html>, so it brings its own
 *  theme provider and can't rely on the app frame. */
import { Button, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { StatusScreen } from "@/components/status-screen";
import { limechatTheme } from "@/theme/theme";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <MantineProvider theme={limechatTheme}>
          <StatusScreen title="LimeCRM couldn't load" actions={<Button onClick={reset}>Try again</Button>}>
            Something went wrong on our side. Reload in a minute; your data is safe.
          </StatusScreen>
        </MantineProvider>
      </body>
    </html>
  );
}
