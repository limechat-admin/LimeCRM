import { Card, Center, Checkbox, Group, Image, Stack, Text, Title } from "@mantine/core";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/forms";
import { db } from "@/db";
import { emailPreferences } from "@/db/schema";
import { SUBSCRIPTION_TYPES } from "@/domain/campaigns";
import { verifyToken } from "@/domain/secret-box";
import { tokenKey } from "@/server/gmail";
import { savePreferencesAction } from "./actions";

export const metadata: Metadata = { title: { absolute: "Email preferences · LimeChat" }, robots: { index: false } };

/** Public email preference page, linked from every campaign email. The signed token is the access. */
export default async function PreferencesPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ all?: string }> }) {
  const { token } = await params;
  const { all } = await searchParams;
  const data = verifyToken<{ e: string; c: string }>(token, tokenKey());
  const [pref] = data?.e ? await db.select().from(emailPreferences).where(eq(emailPreferences.email, data.e)) : [];
  const unsubscribed = !!pref?.unsubscribedAll || !!pref?.suppressed;

  return (
    <Center mih="100dvh" p="md" bg="var(--mantine-color-gray-1)">
      <Card withBorder maw={480} w="100%" padding="xl">
        <Stack gap="lg">
          <Image src="/limechat-wordmark.svg" alt="LimeChat" h={28} w="auto" fit="contain" style={{ alignSelf: "flex-start" }} />
          {!data?.e ? (
            <Text>This link isn&apos;t valid any more. Use the link in a more recent email from LimeChat.</Text>
          ) : all === "1" && !unsubscribed ? (
            <>
              <Title order={3}>Unsubscribe {data.e}?</Title>
              <Text size="sm" c="dimmed">
                You won&apos;t get LimeChat marketing email any more. Emails from your account team about your account still reach you.
              </Text>
              <ActionForm action={savePreferencesAction}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="all" value="1" />
                <Group>
                  <SubmitButton color="red">Unsubscribe</SubmitButton>
                </Group>
              </ActionForm>
            </>
          ) : (
            <>
              <Title order={3}>Email preferences</Title>
              <Text size="sm" c="dimmed">
                For {data.e}.{" "}
                {unsubscribed
                  ? "You're unsubscribed from all LimeChat marketing email. Tick anything you'd like to get again."
                  : "Choose what you'd like to hear about."}
              </Text>
              <ActionForm action={savePreferencesAction}>
                <input type="hidden" name="token" value={token} />
                <Stack gap="sm">
                  {SUBSCRIPTION_TYPES.map((t) => (
                    <Checkbox
                      key={t.key}
                      name={t.key}
                      label={t.label}
                      description={t.help}
                      defaultChecked={!unsubscribed && !pref?.optedOut.includes(t.key)}
                      disabled={pref?.suppressed === "spam_complaint"}
                    />
                  ))}
                  <Group>
                    <SubmitButton>Save preferences</SubmitButton>
                  </Group>
                </Stack>
              </ActionForm>
              {!unsubscribed && (
                <ActionForm action={savePreferencesAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="all" value="1" />
                  <SubmitButton variant="subtle" color="red" size="xs">
                    Unsubscribe from everything
                  </SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
