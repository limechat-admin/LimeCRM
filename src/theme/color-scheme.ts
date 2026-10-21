import type { MantineColorScheme, MantineColorSchemeManager } from "@mantine/core";

/** Light/dark choice lives in a cookie so the server renders the right scheme on <html> — no
 *  bootstrap <script> (which React 19.2 warns about) and no flash of the wrong theme. */
export const COLOR_SCHEME_COOKIE = "lc-color-scheme";

export function parseColorScheme(value: string | undefined): "light" | "dark" {
  return value === "dark" ? "dark" : "light";
}

export function cookieColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: (defaultValue) => {
      if (typeof document === "undefined") return defaultValue;
      const match = document.cookie.match(new RegExp(`(?:^|; )${COLOR_SCHEME_COOKIE}=([^;]*)`));
      return match ? (parseColorScheme(match[1]) as MantineColorScheme) : defaultValue;
    },
    set: (value) => {
      document.cookie = `${COLOR_SCHEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    },
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => {
      document.cookie = `${COLOR_SCHEME_COOKIE}=; path=/; max-age=0`;
    },
  };
}
