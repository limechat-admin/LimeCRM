"use client";
/** Mantine components rendered as Next links. These live in a client module because a server
 *  component can't pass the `Link` function itself to a Mantine (client) component. */
import { Anchor, Button, UnstyledButton, type AnchorProps, type ButtonProps, type UnstyledButtonProps } from "@mantine/core";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export function AnchorLink({ href, children, ...props }: AnchorProps & { href: string; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} {...props}>
      {children}
    </Anchor>
  );
}

export function ButtonLink({
  href,
  children,
  className,
  style,
  ...props
}: UnstyledButtonProps & { href: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <UnstyledButton component={Link} href={href} className={className} style={style} {...props}>
      {children}
    </UnstyledButton>
  );
}

export function LinkButton({ href, children, ...props }: ButtonProps & { href: string; children: ReactNode }) {
  return (
    <Button component={Link} href={href} {...props}>
      {children}
    </Button>
  );
}
