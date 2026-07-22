import { useCallback, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { apiRequest } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { theme } from "../../src/lib/theme";

interface WorkingSetProject {
  id: string;
  name: string;
  code: string;
  status: string;
}

export default function ProjectsScreen() {
  const { session } = useAuth();
  const [projects, setProjects] = useState<WorkingSetProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);
    try {
      const workingSet = await apiRequest<{ projects: WorkingSetProject[] }>("/sync/working-set", {
        token: session.accessToken,
      });
      setProjects(workingSet.projects);
    } catch {
      // architecture.md §6: the working-set manifest is a live call, not
      // part of v1's syncable entities — offline just means a stale (or
      // empty, on first run) list until connectivity returns.
      setError("Couldn't reach the server. Showing the last known list.");
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing[4] }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={theme.colors.brand} />}
        ListHeaderComponent={
          error ? <Text style={{ color: theme.colors.warning, marginBottom: theme.spacing[3] }}>{error}</Text> : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[8] }}>
              No assigned projects.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              padding: theme.spacing[4],
              marginBottom: theme.spacing[3],
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{item.name}</Text>
            <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing[1] }}>
              {item.code} · {item.status}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
