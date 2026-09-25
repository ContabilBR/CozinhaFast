import { SymbolView, SymbolViewProps, SymbolWeight } from "expo-symbols";
import { StyleProp, ViewStyle } from "react-native";

export function IconSymbol({
  ios_icon_name,
  android_material_icon_name,
  size = 24,
  color,
  style,
  weight = "regular",
  onPress,
  onClick,
  onMouseOver,
  onMouseLeave,
  testID,
  accessibilityLabel,
}: {
  ios_icon_name: SymbolViewProps["name"];
  android_material_icon_name: any;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
  onPress?: any;
  onClick?: any;
  onMouseOver?: any;
  onMouseLeave?: any;
  testID?: any;
  accessibilityLabel?: any;
}) {
  return (
    <SymbolView
      // SymbolViewProps doesn't declare these (web/interaction props aren't
      // part of expo-symbols' types), but passing them through is harmless —
      // same as before this was type-checked.
      {...({ onPress, onClick, onMouseOver, onMouseLeave, testID, accessibilityLabel } as any)}
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={ios_icon_name}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}
