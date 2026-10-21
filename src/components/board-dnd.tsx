"use client";
/**
 * Drag-and-drop for the kanban boards. Dropping a card on a column calls the same server action as
 * the stage buttons on the record page, so gates and permissions apply exactly as they do there;
 * a refused move shows what's missing and links to the record to fill it in. Touch devices and
 * keyboard users move records from the record page.
 */
import { Anchor, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import Link from "next/link";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/app/actions";
import classes from "./board.module.css";

type MoveAction = (state: ActionState, fd: FormData) => Promise<ActionState>;
type Dragged = { id: string; from: string; href: string };

const BoardContext = createContext<{
  dragged: Dragged | null;
  setDragged: (d: Dragged | null) => void;
  pendingId: string | null;
  move: (stageKey: string, stageName: string) => void;
} | null>(null);

/** Wraps a board. `idField` is the form field the action expects ("dealId" / "onboardingId"). */
export function DragBoard({ action, idField, children }: { action: MoveAction; idField: string; children: ReactNode }) {
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const move = (stageKey: string, stageName: string) => {
    const d = dragged;
    setDragged(null);
    if (!d || d.from === stageKey) return;
    setPendingId(d.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set(idField, d.id);
      fd.set("stageKey", stageKey);
      const res = await action(null, fd);
      setPendingId(null);
      if (res?.ok) {
        notifications.show({ color: "lime", message: `Moved to ${stageName}` });
      } else if (res?.missing?.length) {
        notifications.show({
          color: "red",
          title: `Can't move to ${stageName} yet`,
          autoClose: 8000,
          message: (
            <>
              <Text size="sm">Fill in first: {res.missing.map((m) => m.label).join(", ")}.</Text>
              <Anchor component={Link} href={d.href} size="sm">
                Open the record
              </Anchor>
            </>
          ),
        });
      } else {
        notifications.show({
          color: "red",
          message: res?.message ?? "Couldn't move it",
        });
      }
    });
  };

  return <BoardContext.Provider value={{ dragged, setDragged, pendingId, move }}>{children}</BoardContext.Provider>;
}

/** A column that accepts drops. Keeps the server-rendered column's own classes. */
export function DropColumn({ stageKey, stageName, className, children }: { stageKey: string; stageName: string; className: string; children: ReactNode }) {
  const board = useContext(BoardContext)!;
  const [over, setOver] = useState(false);
  const accepting = board.dragged && board.dragged.from !== stageKey;
  return (
    <section
      className={`${className} ${over && accepting ? classes.columnOver : ""}`}
      onDragOver={(e) => {
        if (!accepting) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        board.move(stageKey, stageName);
      }}
    >
      {children}
    </section>
  );
}

/** A draggable card; clicking it still opens the record. */
export function DragCard({ id, stageKey, href, children }: { id: string; stageKey: string; href: string; children: ReactNode }) {
  const board = useContext(BoardContext)!;
  const dragging = board.dragged?.id === id;
  const pending = board.pendingId === id;
  return (
    <Link
      href={href}
      className={`${classes.card} ${classes.draggable} ${dragging || pending ? classes.cardDragging : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        board.setDragged({ id, from: stageKey, href });
      }}
      onDragEnd={() => board.setDragged(null)}
      aria-busy={pending || undefined}
    >
      {children}
    </Link>
  );
}
