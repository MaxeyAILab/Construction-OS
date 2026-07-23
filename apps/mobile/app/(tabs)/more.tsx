import { useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { useAuth } from "../../src/lib/auth";
import { syncNow } from "../../src/lib/sync";
import { useTheme } from "../../src/lib/theme";

export default function MoreScreen() {
  const { session, logout } = useAuth();
  const { theme, isHighContrast, setHighContrast } = useTheme();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  async function handleSyncNow() {
    if (!session) return;
    setIsSyncing(true);
    setSyncSummary(null);
    try {
      const { pushed, pulled, photosUploaded } = await syncNow(session);
      setSyncSummary(`Synced: ${pushed} sent, ${pulled} received, ${photosUploaded} photos uploaded.`);
    } catch {
      setSyncSummary("Sync failed — check your connection.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing[4] }}>
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: theme.borderWidth,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          marginBottom: theme.spacing[4],
        }}
      >
        <Text style={{ color: theme.colors.textMuted }}>Signed in as</Text>
        <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: theme.spacing[1] }}>{session?.userId}</Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: theme.borderWidth,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          marginBottom: theme.spacing[4],
          minHeight: theme.minTouchTarget,
        }}
      >
        <View style={{ flex: 1, marginRight: theme.spacing[3] }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>High-contrast mode</Text>
          <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing[1] }}>
            Bigger contrast for outdoor / bright-sunlight use.
          </Text>
        </View>
        <Switch value={isHighContrast} onValueChange={setHighContrast} trackColor={{ true: theme.colors.brand }} />
      </View>

      <Pressable
        onPress={handleSyncNow}
        disabled={isSyncing}
        style={{
          minHeight: theme.minTouchTarget,
          borderColor: theme.colors.brand,
          borderWidth: theme.borderWidth,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          alignItems: "center",
          justifyContent: "center",
          marginBottom: theme.spacing[3],
          opacity: isSyncing ? 0.6 : 1,
        }}
      >
        {isSyncing ? <ActivityIndicator color={theme.colors.brand} /> : <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>Sync now</Text>}
      </Pressable>

      {syncSummary ? <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginBottom: theme.spacing[3] }}>{syncSummary}</Text> : null}

      <Pressable
        onPress={() => logout()}
        style={{
          minHeight: theme.minTouchTarget,
          borderColor: theme.colors.danger,
          borderWidth: theme.borderWidth,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: theme.colors.danger, fontWeight: "600" }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
