import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { LocalTask } from "../../src/features/tasks/repository";
import { listTasks, updateTask } from "../../src/features/tasks/repository";
import { useAuth } from "../../src/lib/auth";
import { syncNow } from "../../src/lib/sync";
import { theme } from "../../src/lib/theme";

export default function TodayScreen() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const all = await listTasks();
    const mine = all.filter((t) => t.status !== "done" && t.status !== "cancelled" && t.assigneeId === session?.userId);
    setTasks(mine);
  }, [session?.userId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      if (session) await syncNow(session);
    } catch {
      // offline or transient network failure — the local list still
      // renders from SQLite; there's nothing actionable to show here.
    } finally {
      await reload();
      setIsRefreshing(false);
    }
  }

  async function markDone(task: LocalTask) {
    await updateTask(task.id, { status: "done" });
    await reload();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing[4] }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.colors.brand} />}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[8] }}>
            Nothing assigned to you yet. Pull down to sync.
          </Text>
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
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1, marginRight: theme.spacing[3] }}>
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{item.title}</Text>
              {item.dueDate ? <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing[1] }}>Due {item.dueDate}</Text> : null}
            </View>
            <Pressable
              onPress={() => markDone(item)}
              style={{
                borderColor: theme.colors.success,
                borderWidth: 1,
                borderRadius: theme.radius.sm,
                paddingVertical: theme.spacing[2],
                paddingHorizontal: theme.spacing[3],
              }}
            >
              <Text style={{ color: theme.colors.success, fontWeight: "600" }}>Done</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
