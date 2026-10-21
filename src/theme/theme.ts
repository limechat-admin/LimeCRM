/** LimeChat Design System V3 (Figma "LimeChat Design System - V3") on Mantine v9.
 *
 *  Same palettes and semantic tokens as LimeNotes (TLDV/vexa clients/terminal/src/limenotes/theme.ts),
 *  which mapped them from Figma. Keep the two in sync until they move into a shared package.
 *  Palettes are 10-shade Mantine scales built around the design system's anchor values; the semantic
 *  tokens (page background, text, dimmed, borders, placeholder, error) are pinned to the exact Figma
 *  values per colour scheme in `cssVariablesResolver`. Components never hard-code colours. */
import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from "@mantine/core";

/** Primary (Figma Colors/Primary): light-mode filled = shade 6 (#6bac1b), dark-mode filled = shade 8 (#508014),
 *  light tint = shade 0 (#f1f7e9). */
const lime: MantineColorsTuple = [
  "#f1f7e9", "#e3efd2", "#c6e0a4", "#a8d074", "#8fc24c",
  "#7eb933", "#6bac1b", "#5e9817", "#508014", "#3f6610",
];

/** Neutrals, light mode: border = shade 3 (#d9d9d9), placeholder = shade 5 (#8c8c8c), dimmed = shade 6 (#808975). */
const gray: MantineColorsTuple = [
  "#fafafa", "#f5f5f5", "#f0f0f0", "#d9d9d9", "#bfbfbf",
  "#8c8c8c", "#808975", "#595d57", "#434343", "#262626",
];

/** Neutrals, dark mode (Mantine reads `dark`): text = 0, dimmed = 2, border = 4, surfaces = 6, body = 7. */
const dark: MantineColorsTuple = [
  "#ffffff", "#d9d9d9", "#bfbfbf", "#a8aca6", "#595959",
  "#4d4d4d", "#434343", "#262626", "#1f1f1f", "#141414",
];

const red: MantineColorsTuple = [
  "#fdecec", "#f9d0d1", "#f3a3a5", "#eb7a7e", "#e45559",
  "#de3a3f", "#da1b21", "#b8161b", "#961216", "#740e11",
];

const green: MantineColorsTuple = [
  "#e9f8ee", "#cdeed8", "#9bdcb2", "#66c98a", "#3db86a",
  "#22ab56", "#16a34a", "#13873d", "#0f6b31", "#0b5024",
];

export const LIMECHAT_FONT = "var(--font-lato), Lato, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const limechatTheme = createTheme({
  primaryColor: "lime",
  primaryShade: { light: 6, dark: 8 },
  colors: { lime, gray, dark, red, green },
  black: "#3c492c",
  white: "#ffffff",
  fontFamily: LIMECHAT_FONT,
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, monospace",
  headings: {
    fontFamily: LIMECHAT_FONT,
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "28px", lineHeight: "36px" },
      h2: { fontSize: "24px", lineHeight: "32px" },
      h3: { fontSize: "20px", lineHeight: "28px" },
      h4: { fontSize: "18px", lineHeight: "24px" },
      h5: { fontSize: "16px", lineHeight: "20px" },
      h6: { fontSize: "16px", lineHeight: "20px" },
    },
  },
  // Figma Text/xs..xl
  fontSizes: { xs: "12px", sm: "14px", md: "16px", lg: "18px", xl: "20px" },
  lineHeights: { xs: "16px", sm: "20px", md: "24px", lg: "28px", xl: "28px" },
  // Figma spacing/2xs..xl = 4, 8, 12, 16, 24
  spacing: { xs: "8px", sm: "12px", md: "16px", lg: "24px", xl: "32px" },
  // Figma radius/2xs = 4 (buttons, inputs, cards), radius/xs = 8 (modals)
  radius: { xs: "4px", sm: "8px", md: "8px", lg: "12px", xl: "16px" },
  defaultRadius: "xs",
  shadows: {
    // Figma effect "sm"
    sm: "0 1px 3px rgba(0,0,0,0.05), 0 10px 15px -5px rgba(0,0,0,0.10), 0 7px 7px -5px rgba(0,0,0,0.04)",
  },
  components: {
    Button: { defaultProps: { fw: 700 } },
    Badge: { defaultProps: { radius: "xs", variant: "light" }, styles: { root: { fontWeight: 600, letterSpacing: 0 } } },
    Card: { defaultProps: { radius: "xs", shadow: "sm", padding: "md" } },
    Paper: { defaultProps: { radius: "xs" } },
    Modal: { defaultProps: { radius: "sm", centered: true } },
    TextInput: { defaultProps: { radius: "xs" } },
    Textarea: { defaultProps: { radius: "xs", autosize: true, minRows: 2 } },
    NumberInput: { defaultProps: { radius: "xs" } },
    Select: { defaultProps: { radius: "xs", allowDeselect: false, comboboxProps: { shadow: "sm" } } },
    TagsInput: { defaultProps: { radius: "xs" } },
    ActionIcon: { defaultProps: { variant: "subtle", color: "gray" } },
    Table: { defaultProps: { verticalSpacing: "sm", horizontalSpacing: "md" } },
  },
});

/** Exact Figma semantic tokens per scheme (Semantic Tokens collection, light / dark modes). */
export const limechatCssVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-body": "#ffffff",
    "--mantine-color-text": "#3c492c",
    "--mantine-color-dimmed": "#808975",
    "--mantine-color-default": "#ffffff",
    "--mantine-color-default-hover": "#fafafa",
    "--mantine-color-default-border": "#d9d9d9",
    "--mantine-color-placeholder": "#8c8c8c",
    "--mantine-color-error": "#da1b21",
    "--lc-surface-muted": "#fafafa",
    "--lc-primary-light": "#f1f7e9",
    "--lc-primary-light-hover": "#edf5e3",
  },
  dark: {
    "--mantine-color-body": "#262626",
    "--mantine-color-text": "#ffffff",
    "--mantine-color-dimmed": "#bfbfbf",
    "--mantine-color-default": "#434343",
    "--mantine-color-default-hover": "#4d4d4d",
    "--mantine-color-default-border": "#595959",
    "--mantine-color-placeholder": "#bfbfbf",
    "--mantine-color-error": "#eb7a7e",
    "--lc-surface-muted": "#2f2f2f",
    "--lc-primary-light": "rgba(107, 172, 27, 0.16)",
    "--lc-primary-light-hover": "rgba(107, 172, 27, 0.24)",
  },
});
