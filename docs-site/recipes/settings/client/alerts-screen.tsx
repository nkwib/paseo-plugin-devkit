import { Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { preferences, type Preferences } from "../shared/preferences";

const TURNS = [
  { label: "Failed or canceled", value: "failed" },
  { label: "Every turn", value: "all" },
] as const;

export function AlertsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const text = { color: theme.colors.foreground };

  if (settings.status === "loading") return <Text style={text}>Loading settings</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Turn alerts">
        <Text style={text}>{settings.error}</Text>
        <SettingsAction label="Stored settings" actionLabel="Reset to defaults" onPress={() => void settings.reset()} />
      </SettingsSection>
    );
  }

  // Save the whole document with the revision it was read at; a save from another client in between is rejected.
  const save = (change: Partial<Preferences>) => void settings.save({ ...settings.values, ...change }, settings.revision);

  return (
    <SettingsSection title="Turn alerts">
      <SettingsCard>
        <SettingsSwitch
          label="Log an alert when a turn ends"
          value={settings.values.enabled}
          disabled={settings.saving}
          onValueChange={(enabled) => save({ enabled })}
        />
        <SettingsSelect
          label="Which turns"
          value={settings.values.turns}
          options={TURNS}
          disabled={settings.saving || !settings.values.enabled}
          onValueChange={(turns) => save({ turns })}
        />
      </SettingsCard>
      {settings.saveError ? <Text accessibilityRole="alert" style={text}>{settings.saveError}</Text> : null}
    </SettingsSection>
  );
}
