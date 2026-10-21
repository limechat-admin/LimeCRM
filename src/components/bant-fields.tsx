"use client";
/** BANT scoring with a live total and what it qualifies for (SOP: Qualified Meeting 50+, SQL 75+). */
import { Badge, Group, NumberInput, SimpleGrid, Text } from "@mantine/core";
import { useState } from "react";
import { bantTotal, qualificationFor, QUALIFIED_MEETING_MIN, SQL_MIN } from "@/domain/leads";

type Scores = { bantBudget: number | null; bantAuthority: number | null; bantNeed: number | null; bantTimeline: number | null };

const PARTS = [
  ["bantBudget", "Budget"],
  ["bantAuthority", "Authority"],
  ["bantNeed", "Need"],
  ["bantTimeline", "Timeline"],
] as const;

const OUTCOME = {
  meeting_completed: { label: "Not qualified", color: "gray" },
  qualified_meeting: { label: "Qualified meeting", color: "lime" },
  sql: { label: "SQL", color: "green" },
} as const;

export function BantFields({ initial }: { initial: Scores }) {
  const [scores, setScores] = useState<Scores>(initial);
  const total = bantTotal(scores);
  const outcome = OUTCOME[qualificationFor(total)];
  return (
    <div>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {PARTS.map(([key, label]) => (
          <NumberInput
            key={key}
            name={key}
            label={label}
            min={0}
            max={25}
            allowDecimal={false}
            clampBehavior="strict"
            value={scores[key] ?? ""}
            onChange={(v) => setScores((s) => ({ ...s, [key]: v === "" ? null : Number(v) }))}
            description="0–25"
          />
        ))}
      </SimpleGrid>
      <Group gap="sm" mt="sm">
        <Text size="sm" fw={700}>
          BANT {total ?? "—"}
          <Text span size="sm" c="dimmed" fw={400}>
            {" "}
            / 100
          </Text>
        </Text>
        {total !== null && <Badge color={outcome.color}>{outcome.label}</Badge>}
        <Text size="xs" c="dimmed">
          Qualified meeting at {QUALIFIED_MEETING_MIN}, SQL at {SQL_MIN}
        </Text>
      </Group>
    </div>
  );
}
