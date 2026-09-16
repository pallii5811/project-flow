/** Minimal React Native stub for Node/Vitest — not a runtime RN shim. */

export const View = "View";
export const Text = "Text";
export const Pressable = "Pressable";
export const SafeAreaView = "SafeAreaView";
export const FlatList = "FlatList";
export const Share = { share: async () => ({ action: "sharedAction" }) };
export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove: () => undefined }),
};
export function useWindowDimensions() {
  return { width: 390, height: 844, scale: 2, fontScale: 1 };
}
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  absoluteFill: {},
  hairlineWidth: 1,
};

export type ViewStyle = Record<string, unknown>;
export type TextStyle = Record<string, unknown>;
export type StyleProp<T> = T | T[] | null | undefined;
export type ViewProps = Record<string, unknown>;
export type TextProps = Record<string, unknown>;
export type PressableProps = Record<string, unknown>;
