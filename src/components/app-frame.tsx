"use client";
/** The LimeCRM app shell: LimeChat header lockup, sidebar navigation, colour-scheme toggle, user menu.
 *  Mirrors the LimeNotes AppFrame so LimeChat's internal products feel like one family. */
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Group,
  Menu,
  NavLink,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Building2, ChartColumn, Handshake, KeyRound, LogOut, Moon, Rocket, Sun, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";
import { initials } from "@/lib/format";

const NAV = [
  { href: "/leads", label: "Leads", icon: UserRoundSearch },
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/onboarding", label: "Onboarding", icon: Rocket },
  { href: "/reports", label: "Reports", icon: ChartColumn },
];

// Admin-only settings, shown under the main navigation.
const ADMIN_NAV = [{ href: "/settings/api-keys", label: "API keys", icon: KeyRound }];

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const next = scheme === "dark" ? "light" : "dark";
  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <ActionIcon size="lg" aria-label={`Switch to ${next} mode`} onClick={() => setColorScheme(next)}>
        {scheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

type FrameUser = { name: string; email: string; role: string };

function UserMenu({ user }: { user: FrameUser }) {
  return (
    <Menu position="bottom-end" width={240} shadow="sm">
      <Menu.Target>
        <UnstyledButton aria-label="Account menu">
          <Avatar radius="xl" size={32} color="lime">
            {initials(user.name)}
          </Avatar>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" fw={600} c="var(--mantine-color-text)">
            {user.name}
          </Text>
          <Text size="xs" c="dimmed">
            {user.email} · {user.role}
          </Text>
        </Menu.Label>
        <Menu.Divider />
        <form action={signOutAction}>
          <Menu.Item type="submit" component="button" color="red" leftSection={<LogOut size={16} />}>
            Sign out
          </Menu.Item>
        </form>
      </Menu.Dropdown>
    </Menu>
  );
}

export function AppFrame({ user, children }: { user: FrameUser; children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname() || "/deals";
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Link href="/deals" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/limechat-icon.svg" alt="" width={28} height={28} style={{ display: "block" }} />
              <Stack gap={0}>
                <Text fw={700} size="lg" lh="22px">
                  LimeCRM
                </Text>
                <Text size="xs" c="dimmed" lh="14px">
                  by LimeChat
                </Text>
              </Stack>
            </Link>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ColorSchemeToggle />
            <UserMenu user={user} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap={4}>
          {[...NAV, ...(user.role === "admin" ? ADMIN_NAV : [])].map((item) => (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={pathname.startsWith(item.href)}
              onClick={close}
              variant="light"
              style={{ borderRadius: 4 }}
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main bg="var(--lc-surface-muted)">{children}</AppShell.Main>
    </AppShell>
  );
}
