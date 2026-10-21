"use client";
import { Button, Code, Group } from "@mantine/core";
import { useEffect } from "react";
import { LinkButton } from "@/components/links";
import { StatusScreen } from "@/components/status-screen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <StatusScreen
      title="Something went wrong"
      actions={
        <Group justify="center">
          <Button onClick={reset}>Try again</Button>
          <LinkButton href="/work" variant="default">
            Go to My work
          </LinkButton>
        </Group>
      }
    >
      Nothing was saved from the last action. Try again, and if it keeps happening, send this reference to the LimeCRM team
      {error.digest ? (
        <>
          : <Code>{error.digest}</Code>
        </>
      ) : (
        "."
      )}
    </StatusScreen>
  );
}
