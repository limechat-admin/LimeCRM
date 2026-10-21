import { Alert, Box, Center, Flex, Group, Stack, Text, Title } from "@mantine/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions";
import { SubmitButton } from "@/components/forms";
import { ALLOWED_EMAIL_DOMAIN } from "@/domain/permissions";
import { resolveViewer } from "@/server/auth";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  domain: `Sign in with your @${ALLOWED_EMAIL_DOMAIN} Google Workspace account.`,
  not_provisioned: "You don't have a LimeCRM account yet. Ask a LimeCRM admin to add you.",
  inactive: "Your LimeCRM access has been turned off. Ask a LimeCRM admin if this is a mistake.",
  Configuration: "Sign-in isn't configured on this server (AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET).",
};

/** Google's "G", in Google's brand colours (third-party logo, so outside the LimeChat palette). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

// Same two-panel layout as the LimeNotes sign-in: brand panel with the wordmark and Limey, form on the right.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const { error, callbackUrl } = await searchParams;
  const { user } = await resolveViewer();
  if (user) redirect(callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/");

  return (
    <Flex mih="100dvh" bg="var(--mantine-color-body)">
      <Flex visibleFrom="md" w="44%" direction="column" justify="space-between" p={48} bg="var(--lc-primary-light)">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/limechat-wordmark.svg" alt="LimeChat" height={28} style={{ width: "auto", alignSelf: "flex-start" }} />
        <Stack align="center" gap="lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/limey-avatar.svg" alt="Limey, the LimeChat mascot" width={168} height={168} style={{ borderRadius: 36 }} />
          <Title order={2} ta="center" maw={380}>
            Every deal, every customer, one record.
          </Title>
          <Text c="dimmed" ta="center" maw={380}>
            LimeCRM tracks sales from first meeting to handover, onboarding, and the live customer book with contracted MRR.
          </Text>
        </Stack>
        <Text size="xs" c="dimmed">
          LimeCRM is LimeChat&apos;s internal CRM.
        </Text>
      </Flex>

      <Center flex={1} p="lg">
        <Stack w="100%" maw={360} gap="lg">
          <Group gap="sm" wrap="nowrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/limechat-icon.svg" alt="" width={36} height={36} />
            <Box>
              <Text fw={700} size="xl" lh={1.1}>
                LimeCRM
              </Text>
              <Text size="xs" c="dimmed">
                by LimeChat
              </Text>
            </Box>
          </Group>

          <Stack gap={4}>
            <Title order={3}>Sign in</Title>
            <Text size="sm" c="dimmed">
              Use your @{ALLOWED_EMAIL_DOMAIN} Google account.
            </Text>
          </Stack>

          {error && (
            <Alert color="red" variant="light">
              {ERRORS[error] ?? "Sign-in failed. Try again, or ask a LimeCRM admin for help."}
            </Alert>
          )}

          <form action={signInAction}>
            <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
            <SubmitButton fullWidth size="md" variant="default" leftSection={<GoogleMark />}>
              Continue with Google
            </SubmitButton>
          </form>
        </Stack>
      </Center>
    </Flex>
  );
}
